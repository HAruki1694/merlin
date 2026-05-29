#!/bin/bash

# Configuration
BACKEND_URL=${MERLIN_BACKEND_URL:-"http://localhost:8000/api/metrics"}
HOSTNAME=$(hostname)

# Generate a unique Agent ID once and save it
if [ ! -f "/tmp/merlin_agent_id.txt" ]; then
    tr -dc 'a-f0-9' < /dev/urandom | head -c 8 > "/tmp/merlin_agent_id.txt"
fi
AGENT_ID=$(cat "/tmp/merlin_agent_id.txt")

echo "Starting Merlin Agent (Bash Version) [$AGENT_ID] on $HOSTNAME..."
echo "Target Backend: $BACKEND_URL"

while true; do
    # 1. Get CPU
    CPU_IDLE=$(vmstat 1 2 | tail -1 | awk '{print $15}')
    CPU_PERCENT=$((100 - CPU_IDLE))
    TOTAL_CPU_CORES=$(nproc)

    # 2. Get RAM
    TOTAL_RAM_GB=$(free -m | awk '/Mem:/ {printf "%.1f", $2/1024}')
    RAM_PERCENT=$(free | awk '/Mem:/ {printf "%.1f", $3/$2 * 100.0}')

    # 3. Get Disk
    TOTAL_DISK_GB=$(df -BG / | awk 'NR==2 {print $2}' | sed 's/G//')
    DISK_PERCENT=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')

    # Construct the JSON payload
    IP_ADDRESS=$(hostname -I | awk '{print $1}')
    if [ -z "$IP_ADDRESS" ]; then
        IP_ADDRESS="127.0.0.1"
    fi

    # 4. Check SSH Status (Port 22)
    if ss -tln | grep -q ":22 "; then
        SSH_STATUS="true"
    else
        SSH_STATUS="false"
    fi

    JSON_PAYLOAD=$(cat <<EOF
{
    "agent_id": "$AGENT_ID",
    "hostname": "$HOSTNAME",
    "ip_address": "$IP_ADDRESS",
    "cpu_percent": $CPU_PERCENT,
    "ram_percent": $RAM_PERCENT,
    "disk_percent": $DISK_PERCENT,
    "total_cpu_cores": $TOTAL_CPU_CORES,
    "total_ram_gb": $TOTAL_RAM_GB,
    "total_disk_gb": $TOTAL_DISK_GB,
    "ssh_status": $SSH_STATUS
}
EOF
)

    # Send data to backend using curl
    curl -s -X POST -H "Content-Type: application/json" -d "$JSON_PAYLOAD" "$BACKEND_URL" > /dev/null

    if [ $? -eq 0 ]; then
        echo "[$(date +'%H:%M:%S')] Metrics sent! CPU: ${CPU_PERCENT}% | RAM: ${RAM_PERCENT}%"
    else
        echo "[$(date +'%H:%M:%S')] Failed to connect to Backend at $BACKEND_URL" >&2
    fi

    # Wait 2 seconds before sending the next one
    sleep 2
done
