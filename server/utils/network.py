"""
network.py — IP detection and mDNS announcement
Detects all local IPv4 addresses (non-loopback).
Optionally announces via mDNS as pocketdeck.local (Phase 6).
"""

import socket
import platform


def get_local_ips() -> list[str]:
    """
    Return all non-loopback IPv4 addresses for this machine.
    Uses getaddrinfo on the hostname to enumerate all bound IPs.
    Falls back to gethostbyname if the primary hostname lookup fails.
    """
    ips: list[str] = []
    hostname = socket.gethostname()

    try:
        # getaddrinfo returns (family, type, proto, canonname, sockaddr)
        results = socket.getaddrinfo(hostname, None, socket.AF_INET)
        for result in results:
            ip = result[4][0]
            if not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except socket.gaierror:
        pass

    # Also try the UDP trick — connect to a public address (no data sent)
    # to discover the outbound interface IP.
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            udp_ip = s.getsockname()[0]
            if not udp_ip.startswith("127.") and udp_ip not in ips:
                ips.append(udp_ip)
    except OSError:
        pass

    # Last resort
    if not ips:
        try:
            fallback = socket.gethostbyname(hostname)
            if not fallback.startswith("127."):
                ips.append(fallback)
        except socket.gaierror:
            ips.append("127.0.0.1")

    return ips


def get_os_name() -> str:
    """Return a normalised OS identifier: windows | macos | linux."""
    sys = platform.system().lower()
    if sys == "windows":
        return "windows"
    elif sys == "darwin":
        return "macos"
    return "linux"
