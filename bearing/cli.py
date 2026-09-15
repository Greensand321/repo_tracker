"""Command-line surface: argument parsing and exit codes only, no logic."""

import argparse
import sys

from bearing import __version__

PLAN = "docs/plans/phase-0-plan.md"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="bearing",
        description="Where was I, what state is every branch in, what deserves attention next.",
    )
    parser.add_argument("--version", action="version", version=f"bearing {__version__}")
    sub = parser.add_subparsers(dest="command")

    brief = sub.add_parser("brief", help="print the prioritized brief")
    brief.add_argument("--repo", action="append", metavar="PATH",
                       help="restrict to one configured repo (repeatable)")
    brief.add_argument("--json", action="store_true", help="emit Brief JSON to stdout")
    brief.add_argument("--html", action="store_true", help="write the HTML snapshot")
    brief.add_argument("--out", metavar="FILE", help="override the output path")
    brief.add_argument("--open", action="store_true", dest="open_",
                       help="open the result in a browser (implies --html)")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command is None:
        build_parser().print_help()
        return 0
    print(f"bearing {args.command}: not implemented yet — see {PLAN}", file=sys.stderr)
    return 2
