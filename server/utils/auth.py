"""
auth.py — Token generation and validation
Generates a random 6-char alphanumeric token on startup.
Validates all incoming connections before processing events.
"""

import secrets
import string

_CHARS = string.ascii_uppercase + string.digits


def generate_token(length: int = 6) -> str:
    """Generate a cryptographically-random uppercase alphanumeric token."""
    return "".join(secrets.choice(_CHARS) for _ in range(length))


def validate_token(provided: str, expected: str) -> bool:
    """Constant-time comparison to prevent timing attacks."""
    return secrets.compare_digest(provided.strip(), expected.strip())
