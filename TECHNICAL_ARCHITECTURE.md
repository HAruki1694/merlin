# Merlin: Deep Dive Technical Architecture & Case Study

This document serves as the serious technical specification for the Merlin telemetry platform. It traces the exact flow of data through the system, bridging architectural concepts directly to the underlying codebase using specific file paths and line numbers.

---

## 1. System Topology & File Structure

The system is containerized and divided into four discrete boundaries:

* **`/agent`**: The client-side telemetry payload generator.
  * `merlin_agent.sh`: The core bash daemon deployed to target nodes.
* **`/backend`**: The FastAPI-based state machine and WebSocket broker.
  * `main.py`: The single-file monolith handling REST ingestion, WS broadcasting, and MongoDB mutation.
* **`/frontend`**: The vanilla JavaScript client responsible for reactive DOM updates.
  * `main.js`: The WebSocket consumer and DOM manipulator.
* **`/vpn`**: The networking perimeter.
  * Defines the OpenVPN client container that the backend shares a network namespace with (`network_mode: "service:vpn"`).

---

## 2. Case Study: The Lifecycle of a Metric

To understand how the pieces fit together, we will trace a single metric update (e.g., RAM usage changing from 50% to 54%) from the remote hardware all the way to the pixels on the user's screen.

### Step 1: Agent Hardware Polling & Dispatch
* **File:** `/agent/merlin_agent.sh`
* **Action:** The bash script runs in an infinite `while true; do` loop. It queries the Linux kernel for hardware utilization (e.g., using `free -m | awk` for memory). It wraps this data in a JSON payload.
* **The Code (Line 60):** The exact execution happens here using `curl`:
  ```bash
  curl -s -X POST -H "Content-Type: application/json" -d "$JSON_PAYLOAD" "$BACKEND_URL" > /dev/null
  ```

### Step 2: Backend API Ingestion
* **File:** `/backend/main.py`
* **Action:** The FastAPI web server is listening on port 8000. It receives the HTTP POST request. FastAPI automatically deserializes the JSON payload into a strictly-typed Python Pydantic model (`AgentMetrics`).
* **The Code (Line 120):** 
  ```python
  @app.post("/api/metrics")
  async def receive_metrics(metrics: AgentMetrics):
  ```

### Step 3: Database Mutation & State Update
* **File:** `/backend/main.py`
* **Action:** Before broadcasting, the backend must ensure the historical state is saved in case of a crash. It updates the MongoDB `agents` collection with the new telemetry and a `"reachable"` status.
* **The Code (Line 128):** 
  ```python
  await agents_collection.update_one(
      {"agent_id": metrics.agent_id},
      { ... "$set": { ... "status": "reachable" } }
  )
  ```
* Immediately after the database update, it updates the hyper-fast, in-memory dictionary `active_agents[metrics.agent_id] = metrics_dict`.

### Step 4: The WebSocket Broadcast
* **File:** `/backend/main.py`
* **Action:** With the state securely stored, the backend must alert the frontend. It triggers the `ConnectionManager`, which loops through every active browser session (WebSocket connection) and shoves the JSON frame down the pipe.
* **The Code (Line 155):**
  ```python
  await manager.broadcast({
      "type": "update",
      "data": metrics_dict
  })
  ```

### Step 5: Frontend Reception & Routing
* **File:** `/frontend/main.js`
* **Action:** The browser's native WebSocket API is listening passively. The `onmessage` event fires exactly when the frame from the backend arrives.
* **The Code (Line 65):**
  ```javascript
  ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
  ```
* **The Code (Line 77):** Recognizing it as an `"update"` type message, it routes the parsed data to the rendering engine: `updateOrRenderCard(message.data);`

### Step 6: Reactive DOM Manipulation
* **File:** `/frontend/main.js`
* **Action:** The Javascript searches the DOM for the HTML `<div>` matching `agent-${agent_id}`. Instead of reloading the page or using a heavy framework like React to diff the DOM, it uses a highly efficient, targeted template string (`createCardHTML`) to rebuild just the HTML for that specific machine's card.
* **The Code (Lines 207 & 225):** The pixels on the screen finally change here:
  ```javascript
  card.innerHTML = createCardHTML(agent, isDead);
  ```

---

## 3. Case Study: The "Unreachable" Watchdog

How does the UI know a machine is dead if the machine isn't alive to tell it?

* **File:** `/backend/main.py`
* **The Setup:** On backend boot (`@app.on_event("startup")`), an asynchronous task is spawned alongside the main API.
* **The Code (Line 63):** The `watchdog_task` runs in a `while True` loop every 5 seconds. It iterates over the in-memory `active_agents` dictionary. If `current_time - agent_data.get("last_seen") > 30`, it identifies a timeout.
* **The Execution:** It explicitly mutates the MongoDB record:
  ```python
  await agents_collection.update_one(
      {"agent_id": agent_id},
      {"$set": {"status": "unreachable"}}
  )
  ```
* **The Broadcast:** It then fires the exact same WebSocket broadcast mechanism (`manager.broadcast`) shown in Step 4, pushing the new `"unreachable"` state to the frontend `main.js`, which reacts by applying the `.dead-machine` CSS class to the card.
