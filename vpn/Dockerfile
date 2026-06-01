FROM dperson/openvpn-client

COPY UK-VPN.ovpn /vpn/
COPY creds.txt /vpn/

CMD ["openvpn", "--config", "/vpn/UK-VPN.ovpn", "--auth-user-pass", "/vpn/creds.txt"]
