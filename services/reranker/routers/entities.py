"""POST /extract-entities endpoint for financial NER."""

import re
import time
import logging
from fastapi import APIRouter
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

# Known financial entity patterns
TICKER_PATTERN = re.compile(r'\b[A-Z]{2,5}\b')
COMPANY_INDICATORS = re.compile(
    r'\b(Inc\.?|Corp\.?|Ltd\.?|LLC|PLC|Group|Holdings?|Technologies|Therapeutics)\b',
    re.IGNORECASE,
)

# Common false positives to exclude
STOP_WORDS = frozenset({
    'THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN',
    'HER', 'WAS', 'ONE', 'OUR', 'OUT', 'HAS', 'HIS', 'HOW', 'ITS',
    'MAY', 'NEW', 'NOW', 'OLD', 'SEE', 'WAY', 'WHO', 'DID', 'GET',
    'HIM', 'LET', 'SAY', 'SHE', 'TOO', 'USE', 'CEO', 'CFO', 'COO',
    'IPO', 'SEC', 'GDP', 'ETF', 'USD', 'EUR', 'GBP', 'YOY', 'QOQ',
    'WITH', 'THAT', 'THIS', 'WILL', 'YOUR', 'FROM', 'THEY', 'BEEN',
    'HAVE', 'EACH', 'MAKE', 'LIKE', 'LONG', 'MANY', 'OVER', 'SUCH',
})


class EntityExtractionRequest(BaseModel):
    texts: list[str]


class ExtractedEntity(BaseModel):
    name: str
    type: str
    confidence: float
    mention_text: str


class EntityExtractionResponse(BaseModel):
    entities: list[ExtractedEntity]
    latency_ms: float


@router.post("/extract-entities", response_model=EntityExtractionResponse)
async def extract_entities(request: EntityExtractionRequest):
    start = time.monotonic()
    all_entities: list[ExtractedEntity] = []
    seen: set[str] = set()

    for text in request.texts:
        # Ticker detection
        for match in TICKER_PATTERN.finditer(text):
            name = match.group()
            if name not in STOP_WORDS and name not in seen:
                seen.add(name)
                all_entities.append(ExtractedEntity(
                    name=name, type="TICKER", confidence=0.6, mention_text=name,
                ))

        # Company name detection
        for match in COMPANY_INDICATORS.finditer(text):
            start_pos = max(0, match.start() - 50)
            context = text[start_pos:match.end()]
            words = context.split()[-4:]
            company_name = " ".join(words)
            if company_name not in seen and len(company_name) > 3:
                seen.add(company_name)
                all_entities.append(ExtractedEntity(
                    name=company_name, type="COMPANY", confidence=0.7,
                    mention_text=company_name,
                ))

    latency = (time.monotonic() - start) * 1000
    return EntityExtractionResponse(
        entities=all_entities,
        latency_ms=round(latency, 2),
    )
