"""
Cloudinary helpers: signed uploads + validation of URLs we store or show.

Signed uploads replace the unsigned preset: only signed-in users can upload,
into a folder we choose, and uploads can be rate limited per user. Once this
is deployed, delete (or restrict) the unsigned preset in the Cloudinary console.
"""
import hashlib
import time
from dataclasses import dataclass
from urllib.parse import urlparse

from app.core.config import settings

UPLOAD_FOLDERS = {"listing": "listings", "dispute": "disputes", "site": "site"}


@dataclass(frozen=True)
class CloudinaryConfig:
    cloud_name: str
    api_key: str
    api_secret: str


def cloudinary_config() -> CloudinaryConfig | None:
    """Parse cloudinary://<key>:<secret>@<cloud_name>."""
    url = urlparse(settings.CLOUDINARY_URL or "")
    if url.scheme != "cloudinary" or not (url.username and url.password and url.hostname):
        return None
    return CloudinaryConfig(cloud_name=url.hostname, api_key=url.username, api_secret=url.password)


def cloud_name() -> str:
    cfg = cloudinary_config()
    return cfg.cloud_name if cfg else ""


def sign_params(params: dict[str, str | int], api_secret: str) -> str:
    """Cloudinary request signature: SHA-1 of sorted 'k=v&k=v' + secret."""
    to_sign = "&".join(f"{k}={params[k]}" for k in sorted(params) if params[k] not in ("", None))
    return hashlib.sha1(f"{to_sign}{api_secret}".encode()).hexdigest()


def signed_upload_params(purpose: str, user_id: str) -> dict:
    cfg = cloudinary_config()
    if cfg is None:
        raise RuntimeError("Cloudinary is not configured")
    params: dict[str, str | int] = {
        "timestamp": int(time.time()),
        "folder": f"naivastay/{UPLOAD_FOLDERS[purpose]}/{user_id}",
    }
    return {
        **params,
        "api_key": cfg.api_key,
        "cloud_name": cfg.cloud_name,
        "signature": sign_params(params, cfg.api_secret),
    }


def is_our_media_url(url: str) -> bool:
    """https://res.cloudinary.com/<our cloud>/(image|video)/upload/..."""
    try:
        u = urlparse(url)
    except ValueError:
        return False
    if u.scheme != "https" or u.netloc != "res.cloudinary.com":
        return False
    parts = u.path.split("/")
    # ['', cloud, resource_type, 'upload', ...]
    if len(parts) < 5 or parts[2] not in ("image", "video") or parts[3] != "upload":
        return False
    cloud = cloud_name()
    return not cloud or parts[1] == cloud
