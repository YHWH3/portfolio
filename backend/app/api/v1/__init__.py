from fastapi import APIRouter

from app.api.v1 import analytics, auth, campaigns, drafts, inbox, kb, leads, personas, safety, tone_profiles, workspace

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(workspace.router)
api_router.include_router(tone_profiles.router)
api_router.include_router(personas.router)
api_router.include_router(campaigns.router)
api_router.include_router(drafts.router)
api_router.include_router(leads.router)
api_router.include_router(inbox.router)
api_router.include_router(kb.router)
api_router.include_router(safety.router)
api_router.include_router(analytics.router)
