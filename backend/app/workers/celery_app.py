from celery import Celery
from celery.schedules import crontab

from app.core.config import settings
from app.core.database import use_null_pool

use_null_pool()

# No result backend: nothing reads task results, and connecting to one made a
# web request hang ~20s whenever Redis was unreachable.
celery = Celery("naivastay", broker=settings.REDIS_URL,
                include=["app.workers.tasks"])   # the worker must import the task code to run it
celery.conf.task_ignore_result = True

celery.conf.beat_schedule = {
    "ical-sync-every-10-min": {
        "task": "app.workers.tasks.sync_all_icals",
        "schedule": crontab(minute="*/10"),
    },
    "send-checkin-reminders": {
        "task": "app.workers.tasks.send_checkin_reminders",
        "schedule": crontab(minute=0, hour=8),   # 8 am EAT
    },
    "expire-unpaid-bookings": {
        "task": "app.workers.tasks.expire_unpaid_bookings",
        "schedule": crontab(minute="*/5"),       # frees held dates, reconciles lost STK callbacks
    },
    "release-due-payouts-and-deposits": {
        "task": "app.workers.tasks.release_due_payouts",
        "schedule": crontab(minute="*/15"),      # 24h post-check-in payouts, 2-day deposit returns
    },
    "auto-complete-bookings": {
        "task": "app.workers.tasks.auto_complete_bookings",
        "schedule": crontab(minute=0, hour=2),   # 2 am EAT. Quiet hours
    },
}
celery.conf.timezone = "Africa/Nairobi"
# Fail fast if Redis is unreachable: a web request must never hang ~20s on it.
celery.conf.broker_connection_timeout = 3
celery.conf.broker_transport_options = {"socket_connect_timeout": 3, "socket_timeout": 5}
celery.conf.task_publish_retry_policy = {"max_retries": 1, "interval_start": 0, "interval_step": 0.5, "interval_max": 0.5}
