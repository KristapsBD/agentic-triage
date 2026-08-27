"""FastAPI HTTP layer: POST /reports and GET /health.

Ticket #13: one consistent response envelope across every outcome (all 2xx);
502 with an error code + report hash only when the pipeline itself couldn't
complete; 400 at the boundary only for truly empty/whitespace-only input —
everything else (short, vague, noisy, or hostile text) flows through the
full pipeline per ADR-0007.
"""

from __future__ import annotations

import requests
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.config import Settings, load_settings
from app.errors import PipelineUnavailableError
from app.pipeline import process_report
from app.port import TriagePort
from app.schemas import ReportRequest

app = FastAPI(title="Bug Report Triage Service")


def get_settings() -> Settings:
    if not hasattr(app.state, "settings"):
        app.state.settings = load_settings()
    return app.state.settings


def get_port() -> TriagePort:
    if not hasattr(app.state, "port"):
        from app.real_port import RealPort

        app.state.port = RealPort(get_settings())
    return app.state.port


@app.get("/health")
def health() -> JSONResponse:
    settings = get_settings()
    try:
        resp = requests.get(f"{settings.gitea_url}/api/healthz", timeout=3)
        gitea_ok = resp.status_code == 200
    except requests.RequestException:
        gitea_ok = False
    if not gitea_ok:
        return JSONResponse(status_code=503, content={"status": "not_ready", "gitea": "unreachable"})
    return JSONResponse(status_code=200, content={"status": "ok", "gitea": "reachable"})


@app.post("/reports")
def post_report(payload: ReportRequest, request: Request) -> JSONResponse:
    raw_report = payload.raw_report
    if not raw_report or not raw_report.strip():
        return JSONResponse(
            status_code=400,
            content={"error_code": "empty_report", "message": "raw_report must not be empty or whitespace-only"},
        )

    port = getattr(request.app.state, "port", None) or get_port()
    settings = get_settings()

    try:
        envelope = process_report(raw_report, port, settings)
    except PipelineUnavailableError as e:
        return JSONResponse(
            status_code=502,
            content={"error_code": e.error_code, "report_hash": e.report_hash},
        )

    return JSONResponse(status_code=200, content=envelope.model_dump(mode="json"))
