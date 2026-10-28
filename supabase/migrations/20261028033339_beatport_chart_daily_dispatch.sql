-- Daily Beatport Tech House Top 100 snapshot at 10:00 UTC (14:00 Abu Dhabi) via GitHub workflow_dispatch.
select cron.schedule('streambase-beatport-chart', '0 10 * * *', $$select ops.dispatch_workflow('beatport_chart_snapshot.yml')$$);
