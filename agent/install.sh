#!/bin/bash

# Merlin Agent Systemd Installer
# Run this script with sudo on the target machine

if [ "$EUID" -ne 0 ]; then
  echo "Please run this installer as root (e.g. sudo bash install.sh)"
  exit 1
fi

echo "===================================="
echo " Merlin Agent Installer "
echo "===================================="

# Ask for backend URL
read -p "Enter Merlin Backend URL [http://localhost:8000/api/metrics]: " USER_URL
BACKEND_URL=${USER_URL:-"http://localhost:8000/api/metrics"}

echo "Installing to /usr/local/bin/merlin_agent.sh..."

# Download agent script directly from github (or assume it's next to the installer for local testing)
# In a real environment, this would curl from a raw github URL.
# For this repo, we will copy it if it exists locally, or fetch it.
if [ -f "merlin_agent.sh" ]; then
    cp merlin_agent.sh /usr/local/bin/merlin_agent.sh
else
    curl -s https://raw.githubusercontent.com/merlin/main/agent/merlin_agent.sh -o /usr/local/bin/merlin_agent.sh
fi

chmod +x /usr/local/bin/merlin_agent.sh

echo "Creating systemd service..."

cat <<EOF > /etc/systemd/system/merlin-agent.service
[Unit]
Description=Merlin Telemetry Agent
After=network.target

[Service]
Type=simple
ExecStart=/bin/bash /usr/local/bin/merlin_agent.sh
Environment="MERLIN_BACKEND_URL=$BACKEND_URL"
Restart=always
RestartSec=3

# Logging Config: Discard noisy success logs, keep failure logs
StandardOutput=null
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

echo "Enabling and starting service..."
systemctl daemon-reload
systemctl enable merlin-agent
systemctl start merlin-agent

echo "===================================="
echo " Installation Complete! "
echo " The Merlin agent is now running in the background."
echo " To check status: systemctl status merlin-agent"
echo " To view error logs: journalctl -u merlin-agent -e"
echo "===================================="
