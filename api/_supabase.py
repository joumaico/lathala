import os

from supabase import Client


def open_supabase_client() -> Client:
    return Client(
        os.getenv("SUPABASE_URL"),
        os.getenv("SUPABASE_SERVICE_ROLE_KEY"),
    )
