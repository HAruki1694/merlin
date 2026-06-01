from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json
from typing import List, Dict
import os
import time
# pyrefly: ignore [missing-import]
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
import asyncio

load_dotenv()

app = FastAPI(title="Merlin Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

@app.on_event("startup")
async def startup_event():
    # Load all existing machines into active_agents
    cursor = agents_collection.find({})
    async for doc in cursor:
        agent_id = doc.get("agent_id")
        if agent_id:
            last_seen = doc.get("last_seen", 0)
            status = doc.get("status", "reachable")
            
            active_agents[agent_id] = {
                "agent_id": agent_id,
                "hostname": doc.get("hostname", "Unknown"),
                "ip_address": doc.get("ip_address", "Unknown"),
                "cpu_percent": 0.0,
                "ram_percent": 0.0,
                "disk_percent": 0.0,
                "total_cpu_cores": 0,
                "total_ram_gb": 0.0,
                "total_disk_gb": 0.0,
                "ssh_status": False,
                "tags": doc.get("tags", []),
                "last_seen": last_seen,
                "status": status
            }

    # Start the background task to monitor for unreachable agents
    asyncio.create_task(watchdog_task())

async def watchdog_task():
    while True:
        await asyncio.sleep(5)
        current_time = int(time.time())
        for agent_id, agent_data in active_agents.items():
            # If haven't seen in > 30 seconds and not already unreachable
            if current_time - agent_data.get("last_seen", 0) > 30:
                if agent_data.get("status") != "unreachable":
                    agent_data["status"] = "unreachable"
                    await agents_collection.update_one(
                        {"agent_id": agent_id},
                        {"$set": {"status": "unreachable"}}
                    )
                    await manager.broadcast({
                        "type": "update",
                        "data": agent_data
                    })

MONGO_URL = os.environ.get("MONGO_URL")
client = AsyncIOMotorClient(MONGO_URL)
db = client.merlin
agents_collection = db.agents
global_tags_collection = db.global_tags

class AgentMetrics(BaseModel):
    agent_id: str
    hostname: str
    ip_address: str
    cpu_percent: float
    ram_percent: float
    disk_percent: float
    total_cpu_cores: int = 0
    total_ram_gb: float = 0.0
    total_disk_gb: float = 0.0
    ssh_status: bool = False
    tags: List[str] = []

# Store the latest metrics for each agent in memory
# Structure: {"agent_id": {...metrics...}}
active_agents: Dict[str, dict] = {}

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        # Send current state upon connection
        await websocket.send_text(json.dumps({
            "type": "init",
            "data": list(active_agents.values())
        }))

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_text(json.dumps(message))
            except Exception as e:
                print(f"Failed to send to a websocket client: {e}")

manager = ConnectionManager()

@app.post("/api/metrics")
async def receive_metrics(metrics: AgentMetrics):
    metrics_dict = metrics.model_dump()
    current_time = int(time.time())
    metrics_dict["last_seen"] = current_time
    metrics_dict["status"] = "reachable"
    
    # Update DB with latest info
    await agents_collection.update_one(
        {"agent_id": metrics.agent_id},
        {
            "$set": {
                "ip_address": metrics.ip_address,
                "hostname": metrics.hostname,
                "last_seen": current_time,
                "status": "reachable"
            },
            "$setOnInsert": {
                "agent_id": metrics.agent_id,
                "tags": []
            }
        },
        upsert=True
    )

    # Fetch tags from DB
    agent_doc = await agents_collection.find_one({"agent_id": metrics.agent_id})
    if agent_doc and "tags" in agent_doc:
        metrics_dict["tags"] = agent_doc["tags"]
    else:
        metrics_dict["tags"] = []

    active_agents[metrics.agent_id] = metrics_dict
    
    # Broadcast the new data to all connected UI clients
    await manager.broadcast({
        "type": "update",
        "data": metrics_dict
    })
    
    return {"status": "success"}

@app.get("/api/tags")
async def get_global_tags():
    cursor = global_tags_collection.find({})
    tags = []
    async for doc in cursor:
        tags.append(doc["name"])
    return {"tags": tags}

class GlobalTagRequest(BaseModel):
    name: str

@app.post("/api/tags")
async def create_global_tag(req: GlobalTagRequest):
    tag = req.name.strip()
    if not tag:
        return {"status": "error", "message": "Tag cannot be empty"}
    await global_tags_collection.update_one({"name": tag}, {"$set": {"name": tag}}, upsert=True)
    
    # Broadcast a special message so frontend knows global tags updated
    await manager.broadcast({"type": "global_tags_update"})
    return {"status": "success", "tag": tag}

@app.delete("/api/tags/{tag}")
async def delete_global_tag(tag: str):
    await global_tags_collection.delete_one({"name": tag})
    
    # Cascade delete from all agents in MongoDB
    await agents_collection.update_many({}, {"$pull": {"tags": tag}})
    
    # Update active agents in memory and broadcast
    for agent_id, agent_data in active_agents.items():
        if "tags" in agent_data and tag in agent_data["tags"]:
            agent_data["tags"].remove(tag)
            await manager.broadcast({"type": "update", "data": agent_data})
            
    await manager.broadcast({"type": "global_tags_update"})
    return {"status": "success"}

class TagRequest(BaseModel):
    tag: str

@app.post("/api/agents/{agent_id}/tags")
async def add_tag(agent_id: str, tag_req: TagRequest):
    tag = tag_req.tag.strip()
    if not tag:
        return {"status": "error", "message": "Tag cannot be empty"}
        
    await agents_collection.update_one(
        {"agent_id": agent_id},
        {"$addToSet": {"tags": tag}},
        upsert=True
    )
    
    if agent_id in active_agents:
        if "tags" not in active_agents[agent_id]:
            active_agents[agent_id]["tags"] = []
        if tag not in active_agents[agent_id]["tags"]:
            active_agents[agent_id]["tags"].append(tag)
            await manager.broadcast({"type": "update", "data": active_agents[agent_id]})
            
    return {"status": "success"}

@app.delete("/api/agents/{agent_id}/tags/{tag}")
async def remove_tag(agent_id: str, tag: str):
    await agents_collection.update_one(
        {"agent_id": agent_id},
        {"$pull": {"tags": tag}}
    )
    
    if agent_id in active_agents:
        if "tags" in active_agents[agent_id] and tag in active_agents[agent_id]["tags"]:
            active_agents[agent_id]["tags"].remove(tag)
            await manager.broadcast({"type": "update", "data": active_agents[agent_id]})
            
    return {"status": "success"}

@app.websocket("/ws/dashboard")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # We don't expect the client to send much, but we need to keep the connection alive
            # and detect disconnects.
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
