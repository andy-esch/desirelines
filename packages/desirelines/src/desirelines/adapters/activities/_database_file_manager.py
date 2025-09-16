import logging
import uuid

from google.api_core.exceptions import NotFound

from desirelines.adapters.gcp._clients import CloudStorageClientWrapper
from desirelines.ports.out.read import FetchDatabase
from desirelines.ports.out.write import UpdateDatabase

logger = logging.getLogger(__name__)


class DatabaseFileManager(FetchDatabase, UpdateDatabase):
    """Handles download/upload of database files"""

    def __init__(self, storage_client: CloudStorageClientWrapper):
        self._storage_client = storage_client

    def download_database(self, year: int) -> str:
        """Download database file and return local file path"""
        # Generate unique filename to avoid collisions
        random_suffix = uuid.uuid4().hex[:8]
        database_filename = f"activities_{year}_{random_suffix}.db"
        filepath = f"/tmp/{database_filename}"
        # Storage uses standard name
        storage_blob_name = f"databases/activities_{year}.db"

        try:
            self._storage_client.download_blob_to_file(storage_blob_name, filepath)
            logger.info("Downloaded database for year=%s to %s", year, filepath)
        except NotFound:
            logger.info(
                "Database not found for year=%s, will create new one at %s",
                year,
                filepath,
            )

        return filepath

    def upload_database(self, file_path: str, year: int) -> None:
        """Upload database file back to storage"""
        storage_blob_name = f"databases/activities_{year}.db"  # Standard storage name
        self._storage_client.upload_file_to_blob(file_path, storage_blob_name)
