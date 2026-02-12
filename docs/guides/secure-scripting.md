# Secure Scripting & Command Guidelines

This guide outlines the standards for creating robust, secure, and maintainable scripts and commands in the `desirelines` repository.

## 1. The Command Runner: `just`

We use `just` as our primary task runner. It provides a unified interface for developer workflows.

### Best Practices

* **Strict Shell Mode**: The global `Justfile` enforces strict shell mode:

    ```makefile
    set shell := ["bash", "-uc"]
    ```

    This ensures all recipes fail fast on errors or undefined variables.

* **Shebang Recipes for Complex Logic**: For recipes involving interactive prompts, loops, or complex logic, use a shebang recipe to ensure a consistent `bash` environment:

    ```makefile
    deploy env:
        #!/usr/bin/env bash
        set -euo pipefail
        # ... script content ...
    ```

* **No Secrets in Args**: Never pass secrets as command arguments (e.g., `just deploy MY_SECRET`). Use `.env` files or fetch secrets dynamically from a secure store (like GCP Secret Manager) inside the script.

## 2. Shell Scripting Standards

All shell scripts in `scripts/` must adhere to the "Bash Strict Mode".

### Header Template

Every script should start with:

```bash
#!/bin/bash
set -euo pipefail

# -e: Exit immediately if a command exits with a non-zero status.
# -u: Treat unset variables as an error.
# -o pipefail: Return exit status of the last command in the pipe that failed.
```

### Formatting & Linting

* **Linting**: All scripts must pass `shellcheck`. Run `pants lint ::` to verify.
* **Formatting**: Use `shfmt`. Run `pants fmt ::` to auto-format.

### Security Rules

1. **Quote Variables**: Always quote variables to prevent globbing and word splitting issues.
    * ✅ `rm "$FILE"`
    * ❌ `rm $FILE`
2. **No Echoing Secrets**: Never `echo` variables containing passwords or keys.
3. **Least Privilege**: Scripts fetching credentials should request the minimum scope required.
4. **Interactive Confirmation**: Destructive actions (like `flyway clean` or `terraform destroy`) must require explicit interactive confirmation.

## 3. Python for Complexity

If a shell script exceeds ~50 lines or requires complex logic (JSON parsing, API calls), rewrite it in **Python**.

* Python scripts live in `scripts/` (e.g., `scripts/data/sync.py`).
* They are managed by Pants (`python_sources`).
* They provide better error handling, testing, and cross-platform compatibility than Bash.
