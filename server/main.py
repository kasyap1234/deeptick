import os
import json
import asyncio
import logging
from datetime import datetime
from typing import Dict, Any, Optional, List

from gradient_adk import entrypoint
from aiohttp_retry import RetryClient, ExponentialRetry
from langchain_gradient import ChatGradient

logger = logging.getLogger("deeptick_adk")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

API_URL = os.environ.get("API_URL", "http://localhost:3001")
RESEARCH_TIMEOUT = int(os.environ.get("RESEARCH_TIMEOUT", "300"))
DEFAULT_MODEL = os.environ.get(
    "DEEP_RESEARCH_ORCHESTRATOR_MODEL", "claude-sonnet-4-20250514"
)


def _base_report() -> Dict[str, Any]:
    return {
        "executiveSummary": "",
        "companySnapshot": "",
        "industryAndMarketStructure": "",
        "businessModelAndUnitEconomics": "",
        "financialQualityAndTrendAnalysis": "",
        "capitalAllocationReview": "",
        "valuationRelative": "",
        "valuationIntrinsic": "",
        "competitivePositionAndMoat": "",
        "managementGovernanceAssessment": "",
        "regulatoryAndLegalRisk": "",
        "bullCase": "",
        "bearCase": "",
        "scenarioFramework": [],
        "catalystCalendar": "",
        "portfolioConstructionView": "",
        "investmentConclusion": "",
        "evidenceIndex": [],
        "auditReport": {
            "status": "pass_with_caveats",
            "checkedClaims": 0,
            "unresolvedClaims": [],
            "notes": ["Generated without external evidence."],
        },
        "sources": [],
    }


def _merge_report(parsed: Dict[str, Any]) -> Dict[str, Any]:
    report = _base_report()
    for key, value in parsed.items():
        if key in report:
            report[key] = value
    return report


def _parse_json(value: str) -> Optional[Dict[str, Any]]:
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None


def _build_prompt(
    query: str, context: Optional[str], focus_areas: Optional[List[str]]
) -> str:
    context_text = f"Context: {context}\n" if context else ""
    focus_text = f"Focus Areas: {', '.join(focus_areas)}\n" if focus_areas else ""
    return (
        "Return JSON only with the following fields: executiveSummary, companySnapshot, "
        "industryAndMarketStructure, businessModelAndUnitEconomics, financialQualityAndTrendAnalysis, "
        "capitalAllocationReview, valuationRelative, valuationIntrinsic, competitivePositionAndMoat, "
        "managementGovernanceAssessment, regulatoryAndLegalRisk, bullCase, bearCase, scenarioFramework, "
        "catalystCalendar, portfolioConstructionView, investmentConclusion, evidenceIndex, auditReport, sources.\n"
        "scenarioFramework must be a list of objects with label, assumptions, implications, probability.\n"
        "auditReport must include status, checkedClaims, unresolvedClaims, notes.\n"
        f"Query: {query}\n{context_text}{focus_text}"
    )


async def _execute_research_via_api(
    query: str, context: Optional[str], focus_areas: Optional[List[str]]
) -> Dict[str, Any]:
    payload = {"query": query, "context": context, "focusAreas": focus_areas or []}
    retry_options = ExponentialRetry(attempts=3)

    async with RetryClient(
        raise_for_status=False, retry_options=retry_options
    ) as session:
        async with session.post(f"{API_URL}/api/research", json=payload) as resp:
            if resp.status != 200:
                error_text = await resp.text()
                raise RuntimeError(f"Failed to create research job: {error_text}")
            data = await resp.json()
            job_id = data["data"]["jobId"]

        start = asyncio.get_event_loop().time()
        while True:
            async with session.get(f"{API_URL}/api/research/{job_id}") as resp:
                job_data = await resp.json()
                job = job_data["data"]

            if job["status"] == "completed":
                async with session.get(
                    f"{API_URL}/api/research/{job_id}/report"
                ) as report_resp:
                    report_data = await report_resp.json()
                    return report_data["data"]

            if job["status"] == "failed":
                raise RuntimeError(job.get("error", "Unknown error"))

            elapsed = asyncio.get_event_loop().time() - start
            if elapsed > RESEARCH_TIMEOUT:
                raise TimeoutError(
                    f"Research timed out after {RESEARCH_TIMEOUT} seconds"
                )

            await asyncio.sleep(2)


async def _execute_research_direct(
    query: str, context: Optional[str], focus_areas: Optional[List[str]]
) -> Dict[str, Any]:
    llm = ChatGradient(
        model=DEFAULT_MODEL,
        temperature=0.2,
        max_retries=3,
        timeout=60,
    )

    prompt = _build_prompt(query, context, focus_areas)
    response = await llm.ainvoke(
        [
            {
                "role": "system",
                "content": "You are an institutional-grade investment research analyst.",
            },
            {"role": "user", "content": prompt},
        ]
    )

    content = (
        response.content
        if isinstance(response.content, str)
        else json.dumps(response.content)
    )
    parsed = _parse_json(content)
    report = _merge_report(parsed or {})

    if not parsed:
        report["executiveSummary"] = content[:1200]
        report["investmentConclusion"] = content[-1200:]

    return {
        "jobId": f"adk-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}",
        "query": query,
        "report": report,
        "sources": report.get("sources", []),
        "metadata": {
            "model": DEFAULT_MODEL,
            "timestamp": datetime.utcnow().isoformat(),
            "mode": "direct",
        },
    }


@entrypoint
async def main(input: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    query = input.get("query") or input.get("message", "")
    research_context = input.get("context")
    focus_areas = input.get("focusAreas") or input.get("focus_areas") or []
    mode = input.get("mode", "direct")
    job_id = (
        f"adk-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}-{abs(hash(query)) % 10000}"
    )

    if not query:
        return {
            "jobId": job_id,
            "status": "error",
            "error": "Missing required field: query",
        }

    try:
        result = (
            await _execute_research_via_api(query, research_context, focus_areas)
            if mode == "api"
            else await _execute_research_direct(query, research_context, focus_areas)
        )

        return {
            "jobId": job_id,
            "query": query,
            "status": "completed",
            "report": result.get("report", {}),
            "sources": result.get("sources", []),
            "metadata": {
                **result.get("metadata", {}),
                "mode": mode,
                "focusAreas": focus_areas,
                "completedAt": datetime.utcnow().isoformat(),
            },
        }
    except TimeoutError as error:
        logger.error("timeout", exc_info=error)
        return {
            "jobId": job_id,
            "query": query,
            "status": "timeout",
            "error": str(error),
        }
    except Exception as error:
        logger.error("error", exc_info=error)
        return {
            "jobId": job_id,
            "query": query,
            "status": "error",
            "error": str(error),
        }
