"""Entry point for `python -m bearing`; delegates to the CLI."""

from bearing.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
