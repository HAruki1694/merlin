import time
import psutil
import requests
import socket
import uuid
import os

# Configuration
# Assuming the backend will run locally on port 8000
BACKEND_URL = os.environ.get("MERLIN_BACKEND_URL", "http://localhost:8000/api/metrics")
AGENT_ID = str(uuid.uuid4())[:8]  # Unique ID for this agent instance
def get_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

HOSTNAME = socket.gethostname()
IP_ADDRESS = get_ip()

def check_ssh():
    """Checks if port 22 is open on localhost."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.settimeout(1)
        result = sock.connect_ex(('127.0.0.1', 22))
        return result == 0
    except:
        return False
    finally:
        sock.close()

def collect_metrics():
    """Collects system metrics using psutil."""
    cpu_percent = psutil.cpu_percent(interval=1)
    total_cpu_cores = psutil.cpu_count(logical=True)
    
    # RAM
    memory = psutil.virtual_memory()
    ram_percent = memory.percent
    total_ram_gb = memory.total / (1024**3)
    
    # Disk (Storage) - getting the root partition
    disk = psutil.disk_usage('/')
    disk_percent = disk.percent
    total_disk_gb = disk.total / (1024**3)
    
    return {
        "agent_id": AGENT_ID,
        "hostname": HOSTNAME,
        "ip_address": IP_ADDRESS,
        "cpu_percent": cpu_percent,
        "ram_percent": ram_percent,
        "disk_percent": disk_percent,
        "total_cpu_cores": total_cpu_cores,
        "total_ram_gb": total_ram_gb,
        "total_disk_gb": total_disk_gb,
        "ssh_status": check_ssh()
    }

def main():
    print(f"Starting Merlin Agent [{AGENT_ID}] on {HOSTNAME}...")
    print(f"Target Backend: {BACKEND_URL}")
    
    while True:
        try:
            metrics = collect_metrics()
            # Push to backend
            response = requests.post(BACKEND_URL, json=metrics, timeout=5)
            if response.status_code == 200:
                print(f"[{time.strftime('%H:%M:%S')}] Metrics sent successfully. CPU: {metrics['cpu_percent']}% | RAM: {metrics['ram_percent']}%")
            else:
                print(f"Failed to send metrics. Status Code: {response.status_code}")
                
        except requests.exceptions.ConnectionError:
            print(f"Connection error. Backend at {BACKEND_URL} might be down.")
        except Exception as e:
            print(f"An error occurred: {e}")
            
        time.sleep(2) # Send metrics every 2 seconds

if __name__ == "__main__":
    main()
