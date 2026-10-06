"""
Hand a job to the background worker without ever failing the web request.

The database change (a refund row, a confirmed booking) is already committed
when we enqueue. If Redis is briefly down, the guest must not see an error for
something that succeeded: log it, and let the scheduled sweeps pick the work up
(release_due_payouts re-sends stuck payouts/refunds every 15 minutes).
"""
import logging

log = logging.getLogger(__name__)


def enqueue(task, *args) -> bool:
    try:
        task.delay(*args)
        return True
    except Exception:
        log.exception("Could not queue %s%s; the scheduled sweep will retry", getattr(task, "name", task), args)
        return False
