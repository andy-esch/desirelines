"""PostgreSQL sync services for webhook processing.

Activity data is now provided inline by the dispatcher's enriched events.
The PostgresWriteService (which fetched from Strava API) is no longer used
by the CloudRun app. The app now creates SqlAlchemyUnitOfWork directly.
"""

__all__: list[str] = []
