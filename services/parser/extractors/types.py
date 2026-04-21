"""Shared extractor return type — matches the /parse response schema."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class Heading:
    level: int
    text: str
    pageStart: Optional[int] = None


@dataclass
class ExtractorResult:
    markdown: str
    headings: List[Heading] = field(default_factory=list)
    page_count: int = 0
    table_count: int = 0
