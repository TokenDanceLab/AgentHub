#!/usr/bin/env python3
"""Shared shell/condition guards for the repository verifiers.

The three gate verifiers read GitHub workflow `run:` blocks. Keeping one
analyzer here prevents the copies from drifting: a construct that one verifier
rejects must be rejected by all of them.
"""

import re

PIPE = re.compile(r"(?<!\|)\|(?!\|)")
SUCCESS_COMMANDS = {"true", ":", "/bin/true", "/usr/bin/true", "echo", "printf", "/bin/echo", "/usr/bin/echo"}
FAILURE_COMMANDS = {"false", "/bin/false", "/usr/bin/false"}
INERT_TOKENS = {
    "echo", "printf", "cat", "true", ":", "false", "-", "--",
    "/bin/true", "/usr/bin/true", "/bin/false", "/usr/bin/false",
    "exit", "return", "if", "elif", "while", "until", "then", "else", "do", "done", "fi",
}
# Commands whose arguments are data, not an execution site. `test python x.py`
# and `which python x.py` inspect a path; they do not run it.
NON_EXECUTING_COMMANDS = {
    "echo", "printf", "cat", "true", ":", "false",
    "/bin/true", "/usr/bin/true", "/bin/false", "/usr/bin/false",
    "exit", "return", "test", "[", "which", "type", "hash", "command", "builtin",
}
INTERPRETER_COMMAND = re.compile(r"(?:.*/)?(?:python[\d.]*|bash|sh|env)")
PYTHON_INTERPRETER = re.compile(r"(?:.*/)?python[\d.]*")
NEEDS_OUTPUT = re.compile(r"needs\.([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_-]+)")
CONTROL_WORDS = {"if", "then", "elif", "else", "fi", "for", "while", "until", "do", "done", "case", "esac", "select", "function"}
SHELL_STATE_WORDS = {"trap", "exec", "eval", "alias", "enable"}
QUOTED_TEXT = re.compile(r"'(?:[^']*)'|\"(?:\\.|[^\"])*\"")
GITHUB_EXPRESSION = re.compile(r"\$\{\{.*?\}\}")
VARIABLE_EXPANSION = re.compile(r"\$\{[^{}]*\}")
COMMAND_SUBSTITUTION = re.compile(r"\$\([^()]*\)")


def strip_comment(line):
    """Drop a shell inline comment; quoted `#` stays content."""
    single = double = False
    kept = []
    index = 0
    while index < len(line):
        char = line[index]
        if double and char == "\\" and index + 1 < len(line):
            kept.extend((char, line[index + 1]))
            index += 2
            continue
        if double:
            double = char != '"'
        elif single:
            single = char != "'"
        elif char == "#" and (index == 0 or line[index - 1] in " \t"):
            break
        elif char in ("'", '"'):
            double = char == '"'
            single = char == "'"
        kept.append(char)
        index += 1
    return "".join(kept)


def unquoted(line):
    """Drop quoted text and expansions so operator scans only see shell syntax."""
    line = QUOTED_TEXT.sub(" ", line)
    line = VARIABLE_EXPANSION.sub(" ", GITHUB_EXPRESSION.sub(" ", line))
    return line


def executed_lines(text):
    """Executed shell lines, with continuations joined and heredoc bodies skipped."""
    lines = []
    buffer = ""
    heredoc = None

    def flush():
        nonlocal buffer, heredoc
        if buffer:
            lines.append(buffer)
            marker = re.search(r"<<-?\s*(['\"]?)([^\s'\";|&]+)\1", buffer)
            if marker:
                heredoc = marker.group(2).lstrip("\\")
        buffer = ""

    for line in str(text or "").splitlines():
        if heredoc is not None:
            if line.strip() == heredoc:
                heredoc = None
            continue
        stripped = strip_comment(line).strip()
        if not stripped:
            continue
        buffer = f"{buffer} {stripped}".strip() if buffer else stripped
        if buffer.endswith("\\"):
            buffer = buffer[:-1].rstrip()
            continue
        flush()
    flush()
    return lines


def command_segment(line, index):
    """The simple command before index, up to the last shell separator."""
    for position in range(index - 1, -1, -1):
        if line[position] in ";&|":
            return line[position + 1:index]
    return line[:index]


def masks_failure(tail):
    """A construct after a gate that can swallow its non-zero exit status.

    `|| exit <nonzero>` and `|| false` keep the failure; any other `||`
    right-hand side decides the step result. A trailing pipeline uses the last
    stage; a background job is not waited for unless `wait` targets its pid.
    `; exit 0` and `; true` are the conventional ignore-failure suffix. `&&` is
    safe: `-e` aborts on the gate, so it is not treated as a mask.
    """
    scan = unquoted(tail)
    if "||" in scan:
        # Evaluate the whole `||` chain left to right. A `false` fallback
        # continues to the next alternative; a non-zero exit/return preserves
        # the failure and stops the chain; anything else may swallow it.
        for rhs in scan.split("||")[1:]:
            command = rhs.split(";")[0].strip()
            status = re.match(r"(?:exit|return)\s+(['\"]?)(\d+|\$\?)\1(?=\s|$|;|[#])", command)
            if status:
                code = status.group(2)
                if code == "$?" or (code.isdigit() and 1 <= int(code) <= 255):
                    return False
                return True
            if re.match(r"(?:\S*/)?false\b", command):
                continue
            return True
        # Every alternative is `false`; the chain itself ends non-zero.
        if PIPE.search(scan):
            return True
        if re.search(r"(?<!&)(?<![>&])&(?![&>])", scan):
            return not re.search(r"\bwait\s+(?:\$!|%|\d)", scan)
        if re.search(r";\s*(?:exit\s+0|true|:)(?=\s|$|[;#])", scan):
            return True
        return False

    if PIPE.search(scan):
        return True
    if re.search(r"(?<!&)(?<![>&])&(?![&>])", scan):
        return not re.search(r"\bwait\s+(?:\$!|%|\d)", scan)
    if re.search(r";\s*(?:exit\s+0|true|:)(?=\s|$|[;#])", scan):
        return True
    return False


def short_circuited(line, index):
    """True when a constant LHS makes the command at index unreachable."""
    before = line[:index]
    latest = None
    for operator in ("||", "&&"):
        position = before.rfind(operator)
        if position >= 0 and (latest is None or position > latest[1]):
            latest = (operator, position)
    if latest is None:
        return False
    operator, position = latest
    if any(char in before[position + 2:] for char in ";&|"):
        return False
    left = before[:position]
    cut = max(left.rfind(";"), left.rfind("&"), left.rfind("|"))
    first = left[cut + 1:].split()
    first = first[0].strip("'\"()") if first else ""
    if operator == "||":
        return first in SUCCESS_COMMANDS
    return first in FAILURE_COMMANDS


def script_execution(line, script, skip_masked=True, skip_negated=True):
    """Argv tokens after `script` when this line executes it, else None.

    A mention inside an argument to a non-executing command (`echo`, `cat`,
    `test`, `which`, ...), after a constant short-circuit, behind `!`, or (when
    `skip_masked`) in a tail whose failure is masked does not count. The script
    may be executed directly or through an interpreter (`python`, `bash`,
    `env`, ...), including assignment substitutions such as
    `OUT=$(python gate.py)`.
    """
    symbols = set(" \t;|&(){}<>'\"`$")
    for match in re.finditer(re.escape(script), line):
        start = match.start()
        if short_circuited(line, start):
            continue
        segment = command_segment(line, start).strip()
        tokens = [token.strip("'\"$({;") for token in segment.split()]
        first = tokens[0].split("=")[-1].lstrip("'\"$({") if tokens else ""
        if first in NON_EXECUTING_COMMANDS:
            continue
        # `python -m py_compile gate.py` compiles the gate; it does not run it.
        python_at = next(
            (position for position, token in enumerate(tokens) if PYTHON_INTERPRETER.fullmatch(token.split("=")[-1])),
            None,
        )
        if python_at is not None and any(token.startswith("-m") for token in tokens[python_at + 1:]):
            continue
        if skip_negated and segment.startswith("!"):
            continue
        if skip_masked and masks_failure(line[start + len(script):]):
            continue
        token_start = start
        while token_start > 0 and line[token_start - 1] not in symbols:
            token_start -= 1
        prefix = line[:token_start].rstrip(" \t'\"")
        if prefix:
            previous = prefix.split()[-1].lstrip("'\"$({")
            if not (INTERPRETER_COMMAND.fullmatch(first) or INTERPRETER_COMMAND.fullmatch(previous)):
                continue
        tail = re.split(r"[;&|]", line[start + len(script):], maxsplit=1)[0]
        return [token.strip("'\"") for token in tail.split()]
    return None


def step_constructs(run):
    """Shell constructs a required-gate step must not use.

    Control flow, groups, functions, heredocs, and shell-state commands move
    or silence a gate in ways a line scanner cannot follow, so their presence
    fails closed. A simple `$(...)` command substitution is stripped before
    the scan; a gate inside it is still found by command_invokes().
    """
    reasons = set()
    for raw in str(run or "").splitlines():
        line = strip_comment(raw).strip()
        if not line:
            continue
        scan = COMMAND_SUBSTITUTION.sub(" ", unquoted(line))
        if "<<" in scan:
            reasons.add("heredoc")
        if re.search(r"\b[A-Za-z_]\w*\s*\(\)", scan):
            reasons.add("function definition")
        if interpreter_inline_payload(scan):
            reasons.add("inline shell payload")
        if re.search(r"[{}()]", scan):
            reasons.add("group or subshell")
        if re.search(r"\bset\s+\+", scan) or re.search(r"\bset\s+-o\s+no?errexit", scan):
            reasons.add("errexit disabled")
        for token in re.split(r"[\s;|&]+", scan):
            word = token.strip("'\"$")
            if word in CONTROL_WORDS:
                reasons.add(f"{word} control flow")
            if word in SHELL_STATE_WORDS:
                reasons.add(f"{word} shell-state change")
    return sorted(reasons)


def interpreter_inline_payload(scan):
    """True when an interpreter receives an inline `-c` payload.

    Options may precede `-c` (`python -u -c`, `bash -eu -c`,
    `python -W ignore -c`), so scan the whole interpreter segment rather than
    only the first option. A script operand ends the scan: `-c` after a
    concrete script path is an argument to that script, not an inline payload.
    """
    tokens = re.split(r"[\s;|&(){}<>]+", scan)
    for index, token in enumerate(tokens):
        if not INTERPRETER_COMMAND.fullmatch(token.strip("'\"")):
            continue
        for following in tokens[index + 1:]:
            operand = following.strip("'\"")
            if "/" in operand or operand.endswith((".py", ".sh")):
                break
            if re.fullmatch(r"-[A-Za-z]*c[A-Za-z]*", operand):
                return True
    return False


def warning_only(item):
    """Any continue-on-error value other than absent/false is treated as truthy."""
    value = item.get("continue-on-error")
    if value is None:
        return False
    return str(value).strip().lower() not in ("false", "", "none")


def constant_truth(text):
    """Evaluate a constant GitHub expression: True, False, or None (unknown)."""
    text = str(text).strip()
    while text.startswith("(") and text.endswith(")"):
        text = text[1:-1].strip()
    if not text:
        return None
    if text.startswith("!"):
        inner = constant_truth(text[1:])
        return None if inner is None else not inner
    if text.startswith("not "):
        inner = constant_truth(text[4:])
        return None if inner is None else not inner
    if "||" in text:
        values = [constant_truth(part) for part in text.split("||")]
        if True in values:
            return True
        if all(value is False for value in values):
            return False
        return None
    if "&&" in text:
        values = [constant_truth(part) for part in text.split("&&")]
        if False in values:
            return False
        if all(value is True for value in values):
            return True
        return None
    literals = {"true": True, "false": False, "1": True, "0": False, "null": False, "''": False, '""': False}
    lowered = text.lower()
    if lowered in literals:
        return literals[lowered]
    quoted_value = re.fullmatch(r"(['\"])([^'\"]*)\1", text)
    if quoted_value:
        return bool(quoted_value.group(2))
    quoted = re.fullmatch(r"(['\"])([^'\"]*)\1\s*==\s*(['\"])([^'\"]*)\3", text)
    if quoted:
        return quoted.group(2).lower() == quoted.group(4).lower()
    numeric = re.fullmatch(r"(\d+)\s*==\s*(\d+)", text)
    if numeric:
        return numeric.group(1) == numeric.group(2)
    comparison = re.fullmatch(r"(\S+)\s*==\s*(\S+)", text)
    if comparison:
        left = constant_truth(comparison.group(1))
        right = constant_truth(comparison.group(2))
        if left is not None and right is not None:
            return left == right
    inequality = re.fullmatch(r"(\S+)\s*!=\s*(\S+)", text)
    if inequality:
        left = constant_truth(inequality.group(1))
        right = constant_truth(inequality.group(2))
        if left is not None and right is not None:
            return left != right
    return None


def trigger_names(workflow):
    """The workflow's declared event names, normalized across scalar/list/mapping `on:`."""
    triggers = workflow.get("on", workflow.get(True))
    if isinstance(triggers, str):
        return {triggers}
    if isinstance(triggers, list):
        return {str(item) for item in triggers}
    if isinstance(triggers, dict):
        return set(triggers)
    return set()


def substitute_event_conditions(condition, triggers, event=None):
    """Fold `github.event_name` comparisons against the declared triggers.

    With `event` set, the comparison is against that concrete event (the merge
    gate); otherwise a literal counts as true when the workflow declares it.
    """
    if event is None and not triggers:
        return condition

    def replace(match):
        operator, literal = match.group(1), match.group(3)
        actual = literal == event if event is not None else literal in triggers
        return "true" if actual == (operator == "==") else "false"

    condition = re.sub(r"github\.event_name\s*(==|!=)\s*(['\"])([^'\"]+)\2", replace, str(condition))

    def replace_reversed(match):
        operator, literal = match.group(3), match.group(2)
        actual = literal == event if event is not None else literal in triggers
        return "true" if actual == (operator == "==") else "false"

    return re.sub(r"(['\"])([^'\"]+)\1\s*(==|!=)\s*github\.event_name", replace_reversed, condition)


def substitute_needs_outputs(condition, job_outputs=None):
    """Fold `needs.<job>.outputs.<key>` references whose key is not declared.

    A declared output has an unknown runtime value, so the reference stays
    opaque (the expression stays unknown). An undeclared key can only be the
    empty string, which makes `== 'true'` false and `!= 'true'` true. A
    condition can therefore disable a required gate without looking constant
    at first glance.
    """
    if job_outputs is None:
        return condition

    def replace(match):
        job, key = match.group(1), match.group(2)
        if job not in job_outputs:
            return "false"
        return match.group(0) if key in job_outputs[job] else "false"

    return NEEDS_OUTPUT.sub(replace, str(condition))


def statically_false(condition, triggers=frozenset(), event=None, job_outputs=None):
    """A condition that can never be true disables the job or step."""
    if isinstance(condition, bool):
        return not condition
    text = substitute_event_conditions(condition or "", triggers, event)
    text = substitute_needs_outputs(text, job_outputs)
    text = re.sub(r"\$\{\{|\}\}", "", text).strip().lower()
    return constant_truth(re.sub(r"\s+", " ", text)) is False
