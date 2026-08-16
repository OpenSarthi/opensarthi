"""
Supervisor Metrics — Lightweight metrics collection for multi-agent supervisor.

Tracks: dispatch count, domain distribution, confidence histogram, fallback rate,
tool scope size, and dispatcher latency.
"""
import time
import threading
from collections import defaultdict
from typing import Dict, List, Optional
from dataclasses import dataclass, field, asdict


@dataclass
class SupervisorMetrics:
    """Aggregated supervisor metrics for a session/run."""
    total_dispatches: int = 0
    domain_counts: Dict[str, int] = field(default_factory=lambda: defaultdict(int))
    fallback_count: int = 0
    confidence_sum: float = 0.0
    tool_scope_sizes: List[int] = field(default_factory=list)
    dispatch_latencies_ms: List[float] = field(default_factory=list)

    def record_dispatch(
        self,
        domains: List[str],
        confidence: float,
        allowed_tools: List[str],
        latency_ms: float,
        is_fallback: bool,
    ):
        self.total_dispatches += 1
        for d in domains:
            self.domain_counts[d] += 1
        if is_fallback:
            self.fallback_count += 1
        self.confidence_sum += confidence
        self.tool_scope_sizes.append(len(allowed_tools))
        self.dispatch_latencies_ms.append(latency_ms)

    def get_summary(self) -> Dict:
        """Return a summary dict suitable for logging/reporting."""
        total = self.total_dispatches
        if total == 0:
            return {"total_dispatches": 0}
        avg_confidence = self.confidence_sum / total
        avg_tool_scope = sum(self.tool_scope_sizes) / total if self.tool_scope_sizes else 0
        avg_latency = sum(self.dispatch_latencies_ms) / total if self.dispatch_latencies_ms else 0
        return {
            "total_dispatches": total,
            "domain_distribution": dict(self.domain_counts),
            "fallback_rate": self.fallback_count / total,
            "avg_confidence": avg_confidence,
            "avg_tool_scope_size": avg_tool_scope,
            "avg_dispatch_latency_ms": avg_latency,
        }


# Thread-local storage for per-request metrics context
_metrics_local = threading.local()

# Global session metrics
_session_metrics = SupervisorMetrics()


def get_session_metrics() -> SupervisorMetrics:
    """Return the global session metrics aggregator."""
    return _session_metrics


def start_dispatch_timer() -> float:
    """Start timing a dispatch operation. Returns start timestamp."""
    return time.perf_counter()


def record_dispatch(
    domains: List[str],
    confidence: float,
    allowed_tools: List[str],
    start_time: float,
    is_fallback: bool = False,
):
    """Record a completed dispatch with metrics."""
    latency_ms = (time.perf_counter() - start_time) * 1000
    _session_metrics.record_dispatch(domains, confidence, allowed_tools, latency_ms, is_fallback)


def reset_metrics():
    """Reset session metrics (e.g., between test runs)."""
    global _session_metrics
    _session_metrics = SupervisorMetrics()