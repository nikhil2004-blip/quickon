"""
network.py — IP detection and mDNS announcement
Detects all local IPv4 addresses (non-loopback).
Optionally announces via mDNS as pocketdeck.local (Phase 6).
"""

import socket
import platform
import os
import subprocess


def get_local_ips() -> list[str]:
    """
    Return all non-loopback IPv4 addresses for this machine.

    Strategy (robust across network changes / hotspots):
    1. Prefer `psutil.net_if_addrs()` if `psutil` is available.
    2. On Windows, parse `ipconfig` output to list IPv4 addresses.
    3. On Unix, parse `ip addr` output.
    4. Fallback to hostname `getaddrinfo` and the UDP "connect to 8.8.8.8" trick.

    The goal is to enumerate every bound IPv4 address so the QR/banner can
    advertise the address on the interface the phone is actually connected to
    (e.g., hotspot).
    """
    ips: list[str] = []

    # 1) psutil if available — most robust
    try:
        import psutil

        for addrs in psutil.net_if_addrs().values():
            for snic in addrs:
                # AF_INET = IPv4
                if getattr(snic, 'family', None) == socket.AF_INET:
                    addr = getattr(snic, 'address', None)
                    if addr and not addr.startswith('127.') and addr not in ips:
                        ips.append(addr)
        # don't return early; allow later sorting/prioritisation to run
    except Exception:
        pass

    # 2) Platform-specific commands
    if os.name == 'nt':
        try:
            out = subprocess.run(['ipconfig'], capture_output=True, text=True, check=False)
            for line in out.stdout.splitlines():
                line = line.strip()
                # Various Windows locales/versions may use different labels — look
                # for 'IPv4' and a following ':'
                if 'ipv4' in line.lower() and ':' in line:
                    parts = line.split(':')
                    ip = parts[-1].strip()
                    if ip and not ip.startswith('127.') and ip not in ips:
                        ips.append(ip)
        except Exception:
            pass
    else:
        # Try `ip addr` on Unix-like systems
        try:
            out = subprocess.run(['ip', 'addr'], capture_output=True, text=True, check=False)
            for line in out.stdout.splitlines():
                line = line.strip()
                if line.startswith('inet '):
                    # "inet 10.0.0.2/24 scope ..."
                    parts = line.split()
                    if len(parts) >= 2:
                        ip = parts[1].split('/')[0]
                        if ip and not ip.startswith('127.') and ip not in ips:
                            ips.append(ip)
        except Exception:
            pass

    # 3) getaddrinfo on hostname
    hostname = socket.gethostname()
    try:
        results = socket.getaddrinfo(hostname, None, socket.AF_INET)
        for result in results:
            ip = result[4][0]
            if not ip.startswith('127.') and ip not in ips:
                ips.append(ip)
    except socket.gaierror:
        pass

    # 4) UDP trick — discover outbound interface IP
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            udp_ip = s.getsockname()[0]
            if not udp_ip.startswith('127.') and udp_ip not in ips:
                ips.append(udp_ip)
    except OSError:
        pass

    # Last resort
    if not ips:
        try:
            fallback = socket.gethostbyname(hostname)
            if not fallback.startswith('127.'):
                ips.append(fallback)
        except socket.gaierror:
            ips.append("127.0.0.1")

    # Prefer private / routable addresses over link-local (169.254.x.x).
    def _addr_weight(a: str) -> int:
        # Private ranges: 10.*, 172.16-31.*, 192.168.*
        try:
            parts = a.split('.')
            if len(parts) == 4:
                p0 = int(parts[0])
                p1 = int(parts[1])
                if p0 == 10:
                    return 0
                if p0 == 192 and p1 == 168:
                    return 0
                if p0 == 172 and 16 <= p1 <= 31:
                    return 0
                if p0 == 169 and p1 == 254:
                    return 2
        except Exception:
            pass
        # Default: non-private, non-link-local
        return 1

    ips_sorted = sorted(ips, key=lambda a: (_addr_weight(a), a))
    return ips_sorted


def get_os_name() -> str:
    """Return a normalised OS identifier: windows | macos | linux."""
    sys = platform.system().lower()
    if sys == "windows":
        return "windows"
    elif sys == "darwin":
        return "macos"
    return "linux"
