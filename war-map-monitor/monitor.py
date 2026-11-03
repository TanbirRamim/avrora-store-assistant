import time
import argparse
import sys
import io

# Ensure UTF-8 output on Windows consoles
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

from rich.console import Console
from rich.table import Table
from rich.panel import Panel

from engine.orchestrator import WarMapOrchestrator
from config import CSV_OUTPUT_PATH, EXCEL_OUTPUT_PATH, JSON_OUTPUT_PATH, DEFAULT_POLL_INTERVAL

console = Console(force_terminal=True, legacy_windows=False)


def render_datasheet_table(rows: list, summary: dict):
    table = Table(
        title="🇺🇦 AVRORA STORES: REAL-TIME WAR MAP THREAT MONITOR",
        caption=f"Updated: {summary['generated_at']} | Frontline Source: {summary['frontline_data_source']}",
        header_style="bold cyan",
        show_lines=True
    )

    table.add_column("Store / City", style="bold white", width=16)
    table.add_column("Address", width=22)
    table.add_column("Front (km)", justify="right", width=10)
    table.add_column("Threat Zone", justify="center", width=14)
    table.add_column("Siren Alert", justify="center", width=14)
    table.add_column("Manager Action Directive", width=42)
    table.add_column("Nearest Shelter", width=24)

    for r in rows:
        zone = r["threat_zone"]
        if zone == "RED":
            zone_text = f"[bold red]{zone} (<25km)[/]"
        elif zone == "ORANGE":
            zone_text = f"[bold dark_orange]{zone} (25-65km)[/]"
        elif zone == "YELLOW":
            zone_text = f"[bold yellow]{zone}[/]"
        else:
            zone_text = f"[bold green]{zone}[/]"

        alert = r["alert_status"]
        if "HROMADA" in alert or "OBLAST" in alert:
            alert_text = "[bold white on red] 🚨 SIREN ACTIVE [/]"
        else:
            alert_text = "[green]🟢 ALL CLEAR[/]"

        action = r.get("action_en", "")
        if "EVACUATE" in action or "STOP CHECKOUT" in action:
            action_styled = f"[bold red]{action}[/]"
        elif "VIGILANCE" in action:
            action_styled = f"[yellow]{action}[/]"
        else:
            action_styled = f"[dim]{action}[/]"

        table.add_row(
            f"[bold]{r['store_id']}[/]\n{r['city']}",
            f"{r['address']}",
            f"[bold yellow]{r['dist_frontline_km']}[/] km",
            zone_text,
            alert_text,
            action_styled,
            f"[dim]{r['shelter_nearby']}[/]"
        )

    return table


def print_summary_card(summary: dict):
    summary_text = (
        f"🏬 [bold]Stores Tracked:[/] {summary['total_stores']}  |  "
        f"🚨 [bold red]Under Siren Alert (In Shelter):[/] {summary['stores_under_alarm']}  |  "
        f"🔴 [bold red]Red Zone (<25km):[/] {summary['stores_in_red_zone']}  |  "
        f"🟠 [bold orange1]Orange Zone (25-65km):[/] {summary['stores_in_orange_zone']}\n"
        f"📁 [bold cyan]Data Sheet:[/] [underline]{CSV_OUTPUT_PATH}[/] (CSV) | "
        f"[underline]{JSON_OUTPUT_PATH}[/] (JSON)"
    )
    console.print(Panel(summary_text, style="bold cyan", expand=False))


def main():
    parser = argparse.ArgumentParser(description="Avrora War Map Monitor (Simple View)")
    parser.add_argument("--once", action="store_true", help="Run single update cycle")
    parser.add_argument("--interval", type=int, default=DEFAULT_POLL_INTERVAL, help="Refresh interval (seconds)")
    args = parser.parse_args()

    orchestrator = WarMapOrchestrator()

    if args.once:
        rows, summary = orchestrator.process_cycle()
        print_summary_card(summary)
        console.print(render_datasheet_table(rows, summary))
        return

    try:
        while True:
            console.clear()
            rows, summary = orchestrator.process_cycle()
            print_summary_card(summary)
            console.print(render_datasheet_table(rows, summary))
            console.print(f"\n[dim]Next sync in {args.interval}s... Press Ctrl+C to stop.[/]")
            time.sleep(args.interval)
    except KeyboardInterrupt:
        console.print("\n[yellow]Monitor stopped.[/]")


if __name__ == "__main__":
    main()
