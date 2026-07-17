from pathlib import Path

for path in [
    "hub-server/internal/app/wiring.go",
    "hub-server/tests/setup_test.go",
]:
    p = Path(path)
    t = p.read_text(encoding="utf-8")
    t2 = t.replace("MessageService:", "Service:")
    if t2 != t:
        p.write_text(t2, encoding="utf-8", newline="\n")
        print(path, "updated MessageService: -> Service:")
    else:
        print(path, "already ok or no field")
        for i, line in enumerate(t.splitlines(), 1):
            if "MessageService" in line or "Service:" in line and "message" in line.lower():
                print(f"  {i}: {line}")

p = Path("docs/analysis/hub-service-boundary-map.md")
t = p.read_text(encoding="utf-8")


def rep(old: str, new: str, label: str) -> None:
    global t
    if old not in t:
        raise SystemExit(f"missing {label}: {old[:120]!r}")
    t = t.replace(old, new)
    print("ok", label)


rep(
    """### 6k. (Reserved — future IM typed package move)

| Field | Value |
|-------|-------|
| Suggested title | `[P29.x] Hub next IM typed-service package move (Session/Message recommended) after #697` |
| Depends on | #697 Attachment package move |
| Scope | Move **only** `SessionService` or `MessageService` to a sibling package (agentteam-style); keep pure helpers in `service/im`; preserve handler contracts |
| Non-goals | Big-bang package move of remaining IM typed services; OpenAPI/frontend redesign; DispatchService package move; outbox model package move |
| Primary files | `service/session.go` or `service/message.go` → new package; `app/wiring.go`; related tests; boundary map |
| Risk note | Pure IM package closed (#628/#639/#651); MessageReaction + Workspace + Contact + Attachment typed packages landed (#662/#673/#685/#697); Message + Session ports closed but still flat |
""",
    """### 6k. Sixth IM typed-service package move (`service/message`, #720)

| Field | Value |
|-------|-------|
| Title | Sixth IM typed-service package move Message |
| Depends on | #708 Session package move; #585 Message bus+cache ports |
| Scope | Move **only** `MessageService` to `service/message` (agentteam-style); keep pure helpers in `service/im`; preserve handler contracts |
| Non-goals | Multi-service move; OpenAPI/frontend redesign; DispatchService package move; outbox model package move |
| Primary files | `service/message.go` → `service/message/`; `app/wiring.go` / `app.go`; handler/tests; boundary map |
| Decision | **Landed #720** — Bus+Cache ports stay interface-shaped; pure helpers remain in `im`; flat `message.go` removed |
""",
    "6k",
)

rep(
    """- **Map:** six domains in flat package; **agent_runtime + im_messaging** dominate; **agentteam** is the extract template; **`agentevent`** + **`deliveryoutbox`** + **`im`** are pure seams; **`messagereaction`** + **`workspace`** + **`contact`** + **`attachment`** are IM typed-service extracts; **`RunEventService`**, **`EdgeCallbackService`**, **`DeliveryOutbox`**, **`DispatchService`**, **`MessageService`**, and **`SessionService`** are orchestration type extracts still flat (IM services were pre-typed; #585/#593/#594/#606/#639 ports; #617 dispatch residual ports; #628/#639/#651 pure IM helpers; #662 MessageReaction package; #673 Workspace package; #685 Contact package; #697 Attachment package).
- **Highest remaining coupling:** package flatness + `AgentService` facade/custom-agent surface; runtime redispatch + residual ports **closed** on `DispatchService`; optional outbox model package move still high-risk; remaining IM typed-service package moves (session/message) still deferred one-at-a-time.
- **Landed:** pure **`agentevent`** (#468) + **`RunEventService`** (#478) + **`EdgeCallbackService`** (#505) + pure **`deliveryoutbox`** (#514) + **#528 docs sketch** + **#540 thin `DeliveryOutbox` + opaque `Redispatcher`** + **#551 model residual** + **#563 thin `DispatchService` first seam** + **#573 redispatch residual** + **#585 MessageService thin first seam** + **#593 SessionService thin first seam** + **#594 ContactService thin first seam** + **#606 AttachmentService thin first seam** + **#617 DispatchService residual ports** + pure **`im`** (#628) + deeper pure **`im`** + **MessageReaction bus port** (#639) + workspace field pure helpers + reaction summary pure helpers + typed-move sketch (#651) + **first IM typed package `messagereaction` (#662)** + **second IM typed package `workspace` (#673)** + **third IM typed package `contact` (#685)** + **fourth IM typed package `attachment` (#697)**.
- **Pure residual (runtime):** **closed**. **Pure residual (IM):** first + deeper + #651 residual **landed** (#628/#639/#651). **First typed IM package residual:** **landed** (#662). **Second typed IM package residual:** **landed** (#673). **Third typed IM package residual:** **landed** (#685). **Fourth typed IM package residual:** **landed** (#697).
""",
    """- **Map:** six domains in flat package; **agent_runtime** still dominates residual flat surface; **agentteam** is the extract template; **`agentevent`** + **`deliveryoutbox`** + **`im`** are pure seams; **`messagereaction`** + **`workspace`** + **`contact`** + **`attachment`** + **`session`** + **`message`** are IM typed-service extracts; **`RunEventService`**, **`EdgeCallbackService`**, **`DeliveryOutbox`**, and **`DispatchService`** remain orchestration type extracts still flat (#478/#505/#540/#563/#573/#617).
- **Highest remaining coupling:** package flatness + `AgentService` facade/custom-agent surface; runtime redispatch + residual ports **closed** on `DispatchService`; optional outbox model package move still high-risk; primary IM typed-service package moves **closed** (#662/#673/#685/#697/#708/#720).
- **Landed:** pure **`agentevent`** (#468) + **`RunEventService`** (#478) + **`EdgeCallbackService`** (#505) + pure **`deliveryoutbox`** (#514) + **#528 docs sketch** + **#540 thin `DeliveryOutbox` + opaque `Redispatcher`** + **#551 model residual** + **#563 thin `DispatchService` first seam** + **#573 redispatch residual** + **#585 MessageService thin first seam** + **#593 SessionService thin first seam** + **#594 ContactService thin first seam** + **#606 AttachmentService thin first seam** + **#617 DispatchService residual ports** + pure **`im`** (#628) + deeper pure **`im`** + **MessageReaction bus port** (#639) + workspace field pure helpers + reaction summary pure helpers + typed-move sketch (#651) + **first IM typed package `messagereaction` (#662)** + **second IM typed package `workspace` (#673)** + **third IM typed package `contact` (#685)** + **fourth IM typed package `attachment` (#697)** + **fifth IM typed package `session` (#708)** + **sixth IM typed package `message` (#720)**.
- **Pure residual (runtime):** **closed**. **Pure residual (IM):** first + deeper + #651 residual **landed** (#628/#639/#651). **IM typed package residual:** **closed** for primary surfaces (#662/#673/#685/#697/#708/#720).
""",
    "bottom map",
)

rep(
    """- **#697 decision:** fourth IM typed-service package move **landed** as `service/attachment` (agentteam-style). ObjectStorage port + LocalStorage/S3Storage + Service + methods moved; wiring/app/handler/tests updated; flat `attachment.go` stripped to thin aliases (`IsValidAttachmentHash`/`PathFromHash`/`NormalizeAttachmentMetadataJSON` → `im`); `s3_client.go` moved into new package. Pure helpers stay in `service/im`; thin aliases preserved for handler/test call sites. One service only; no OpenAPI/handler/frontend redesign.
- **Next code step:** next IM typed-service package move (`SessionService` / `MessageService` recommended in order) / remaining IM typed packages one-at-a-time / optional outbox model package move (still deferred/high-risk).
""",
    """- **#697 decision:** fourth IM typed-service package move **landed** as `service/attachment` (agentteam-style). ObjectStorage port + LocalStorage/S3Storage + Service + methods moved; wiring/app/handler/tests updated; flat `attachment.go` stripped to thin aliases (`IsValidAttachmentHash`/`PathFromHash`/`NormalizeAttachmentMetadataJSON` → `im`); `s3_client.go` moved into new package. Pure helpers stay in `service/im`; thin aliases preserved for handler/test call sites. One service only; no OpenAPI/handler/frontend redesign.
- **#708 decision:** fifth IM typed-service package move **landed** as `service/session` (agentteam-style). Bus+Cache ports + DTOs + methods moved; wiring/app/handler/tests updated; flat `session.go` removed. One service only; no OpenAPI/handler/frontend redesign.
- **#720 decision:** sixth IM typed-service package move **landed** as `service/message` (agentteam-style). Bus+Cache ports + DTOs + methods moved; pure helpers remain in `service/im`; wiring/app/handler/tests updated; flat `message.go` removed. One service only; no OpenAPI/handler/frontend redesign.
- **Next code step:** optional outbox model package move / optional `DispatchService` package move (still deferred/high-risk) / AgentService facade residual cleanup.
""",
    "next step",
)

p.write_text(t, encoding="utf-8", newline="\n")
print("boundary bottom updated")
