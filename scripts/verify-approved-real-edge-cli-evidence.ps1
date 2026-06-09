#!/usr/bin/env pwsh
<#
AgentHub approved-real Edge CLI evidence verifier.

This verifier never executes Codex, Claude Code, OpenCode, model APIs, login,
network calls, or process-launch commands. It only dereferences approved,
redacted evidence files and checks that the manifest matches the event log and
optional hash manifest before reporting real_tested=true.
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = ".",
    [string]$ObservedManifest = "",
    [string]$EvidenceRoot = "",
    [string]$ApprovalMarker = "",
    [switch]$ApproveRealEvidence
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
$Passed = 0
$Failed = 0
$Blocks = 0
$HashVerified = $false

$SupportedAdapterIds = @("codex", "claude-code", "opencode")
$SecretLikePattern = '(?i)(sk-[a-z0-9_-]{8,}|gh[pousr]_[a-z0-9_]{8,}|xox[baprs]-[a-z0-9-]+|AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|(?:token|secret|api[_-]?key|password|authorization)\s*[:=]\s*\S+)'

function Pass([string]$Text) {
    $script:Passed++
    Write-Host "PASS $Text" -ForegroundColor Green
}

function Fail([string]$Text) {
    $script:Failed++
    Write-Host "FAIL $Text" -ForegroundColor Red
}

function Block([string]$Text) {
    $script:Blocks++
    Write-Host "BLOCK $Text" -ForegroundColor Yellow
}

function Get-JsonFile {
    param(
        [string]$Path,
        [string]$Label
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        Block "$Label path missing"
        return $null
    }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        Block "$Label artifact/log not found: $Path"
        return $null
    }

    $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    if ($raw -match $SecretLikePattern) {
        Fail "$Label contains secret-like content"
        return $null
    }

    try {
        $json = $raw | ConvertFrom-Json
    } catch {
        Fail "$Label is not valid JSON"
        return $null
    }
    Pass "$Label JSON parsed"
    return $json
}

function Get-RequiredPropertyValue {
    param(
        [object]$Object,
        [string]$Name,
        [string]$Label
    )

    if ($null -eq $Object) {
        return $null
    }

    $prop = $Object.PSObject.Properties[$Name]
    if ($null -eq $prop) {
        Block "$Label $Name is missing"
        return $null
    }
    return $prop.Value
}

function Test-RequiredBoolTrue {
    param(
        [object]$Object,
        [string]$Name,
        [string]$Label
    )

    $value = Get-RequiredPropertyValue $Object $Name $Label
    if ($null -eq $value) {
        return $false
    }
    if ($value -isnot [bool]) {
        Block "$Label $Name must be boolean true"
        return $false
    }
    if ($value -ne $true) {
        Block "$Label $Name is not true"
        return $false
    }
    Pass "$Label $Name=true"
    return $true
}

function Test-RequiredBoolValue {
    param(
        [object]$Object,
        [string]$Name,
        [string]$Label,
        [bool]$Expected
    )

    $value = Get-RequiredPropertyValue $Object $Name $Label
    if ($null -eq $value) {
        return $false
    }
    if ($value -isnot [bool]) {
        Block "$Label $Name must be boolean $Expected"
        return $false
    }
    if ($value -ne $Expected) {
        Block "$Label $Name must be $Expected"
        return $false
    }
    Pass "$Label $Name=$($Expected.ToString().ToLowerInvariant())"
    return $true
}

function Get-RequiredString {
    param(
        [object]$Object,
        [string]$Name,
        [string]$Label
    )

    $value = Get-RequiredPropertyValue $Object $Name $Label
    if ($null -eq $value) {
        return $null
    }
    if ($value -isnot [string] -or [string]::IsNullOrWhiteSpace($value)) {
        Block "$Label $Name must be a non-empty string"
        return $null
    }
    Pass "$Label $Name is present"
    return [string]$value
}

function Test-RequiredExitCodeZero {
    param(
        [object]$Object,
        [string]$Label
    )

    $value = Get-RequiredPropertyValue $Object "exitCode" $Label
    if ($null -eq $value) {
        return $false
    }
    if (-not ($value -is [int] -or $value -is [long])) {
        Block "$Label exitCode must be integer 0"
        return $false
    }
    if ([long]$value -ne 0) {
        Block "$Label exitCode is not 0"
        return $false
    }
    Pass "$Label exitCode=0"
    return $true
}

function Test-ApprovalMarker {
    if (-not $ApproveRealEvidence) {
        Block "approval marker gate is closed: pass -ApproveRealEvidence with -ApprovalMarker"
        return $false
    }
    if ([string]::IsNullOrWhiteSpace($ApprovalMarker)) {
        Block "approval marker missing"
        return $false
    }
    if (-not (Test-Path -LiteralPath $ApprovalMarker -PathType Leaf)) {
        Block "approval marker file does not exist"
        return $false
    }
    Pass "approval marker exists"
    return $true
}

function Resolve-EvidencePath {
    param(
        [string]$Reference,
        [string]$Root,
        [string]$Label
    )

    if ([string]::IsNullOrWhiteSpace($Reference)) {
        Block "$Label path missing"
        return $null
    }

    $candidate = if ([System.IO.Path]::IsPathRooted($Reference)) { $Reference } else { Join-Path $Root $Reference }
    $resolved = [System.IO.Path]::GetFullPath($candidate)
    $resolvedRoot = [System.IO.Path]::GetFullPath($Root)
    $rootPrefix = $resolvedRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

    if (-not ([string]::Equals($resolved, $resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase) -or $resolved.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase))) {
        Block "$Label path escapes evidence root"
        return $null
    }

    return $resolved
}

function Get-EventId {
    param([object]$Event)
    foreach ($name in @("id", "eventId", "event_id")) {
        $prop = $Event.PSObject.Properties[$name]
        if ($null -ne $prop -and $prop.Value -is [string] -and -not [string]::IsNullOrWhiteSpace($prop.Value)) {
            return [string]$prop.Value
        }
    }
    return $null
}

function Get-EventString {
    param(
        [object]$Event,
        [string[]]$Names
    )

    foreach ($name in $Names) {
        $prop = $Event.PSObject.Properties[$name]
        if ($null -ne $prop -and $prop.Value -is [string] -and -not [string]::IsNullOrWhiteSpace($prop.Value)) {
            return [string]$prop.Value
        }
    }
    return $null
}

function Get-EventBool {
    param(
        [object]$Event,
        [string]$Name
    )

    $prop = $Event.PSObject.Properties[$Name]
    if ($null -eq $prop -or $prop.Value -isnot [bool]) {
        return $null
    }
    return [bool]$prop.Value
}

function Get-EventsFromLog {
    param([object]$Log)

    if ($null -eq $Log) {
        return @()
    }
    if ($Log -is [array]) {
        return @($Log)
    }

    $eventsProp = $Log.PSObject.Properties["events"]
    if ($null -ne $eventsProp) {
        return @($eventsProp.Value)
    }

    return @()
}

function Find-EventById {
    param(
        [object[]]$Events,
        [string]$EventId
    )

    foreach ($event in $Events) {
        if ((Get-EventId $event) -eq $EventId) {
            return $event
        }
    }
    return $null
}

function Test-EventCommonFields {
    param(
        [object]$Event,
        [string]$Label,
        [string]$ExpectedCorrelationId,
        [string]$ExpectedAdapterId
    )

    $ok = $true
    if ($null -eq $Event) {
        Block "$Label event missing"
        return $false
    }

    $correlationId = Get-EventString $Event @("correlationId", "correlation_id")
    if ($correlationId -eq $ExpectedCorrelationId) {
        Pass "$Label correlationId matches manifest"
    } else {
        Block "$Label correlationId mismatch"
        $ok = $false
    }

    $adapterId = Get-EventString $Event @("adapterId", "adapter", "adapter_id")
    if ($adapterId -eq $ExpectedAdapterId) {
        Pass "$Label adapterId matches manifest"
    } else {
        Block "$Label adapterId mismatch"
        $ok = $false
    }

    if ((Get-EventBool $Event "redacted") -eq $true) {
        Pass "$Label redacted=true"
    } else {
        Block "$Label redacted must be true"
        $ok = $false
    }

    if ((Get-EventBool $Event "noSecrets") -eq $true) {
        Pass "$Label noSecrets=true"
    } else {
        Block "$Label noSecrets must be true"
        $ok = $false
    }

    return $ok
}

function Test-ManifestShape {
    param([object]$Manifest)

    if ($null -eq $Manifest) {
        return $false
    }

    $ok = $true
    foreach ($field in @("requestMapped", "invocationPlanObserved", "eventReplayObserved", "realCliObserved", "redacted", "noSecrets")) {
        if (-not (Test-RequiredBoolTrue $Manifest $field "observed manifest")) {
            $ok = $false
        }
    }
    if (-not (Test-RequiredBoolValue $Manifest "mockAdapterUsed" "observed manifest" $false)) {
        $ok = $false
    }
    if (-not (Test-RequiredBoolValue $Manifest "realCliTested" "observed manifest" $true)) {
        $ok = $false
    }
    if (-not (Test-RequiredBoolValue $Manifest "realModelTested" "observed manifest" $false)) {
        $ok = $false
    }
    if (-not (Test-RequiredBoolValue $Manifest "tokenDanceIdLogin" "observed manifest" $false)) {
        $ok = $false
    }

    foreach ($field in @("realCliTestedReason", "realModelTestedReason", "tokenDanceIdLoginReason", "failureReason", "recordingEvidencePath")) {
        if ($null -eq (Get-RequiredString $Manifest $field "observed manifest")) {
            $ok = $false
        }
    }

    $adapterId = Get-RequiredString $Manifest "adapterId" "observed manifest"
    if ($adapterId -in $SupportedAdapterIds) {
        Pass "observed manifest adapterId is supported"
    } else {
        Block "observed manifest adapterId is unsupported"
        $ok = $false
    }

    foreach ($field in @("approvalId", "observedEvidenceRef", "correlationId", "invocationPlanEventId", "terminalEventId", "terminalStatus")) {
        if ($null -eq (Get-RequiredString $Manifest $field "observed manifest")) {
            $ok = $false
        }
    }

    if ([string](Get-RequiredPropertyValue $Manifest "terminalStatus" "observed manifest") -eq "finished") {
        Pass "observed manifest terminalStatus=finished"
    } else {
        Block "observed manifest terminalStatus is not finished"
        $ok = $false
    }

    if (-not (Test-RequiredExitCodeZero $Manifest "observed manifest")) {
        $ok = $false
    }

    $planId = Get-RequiredPropertyValue $Manifest "invocationPlanEventId" "observed manifest"
    $terminalId = Get-RequiredPropertyValue $Manifest "terminalEventId" "observed manifest"
    if ($planId -is [string] -and $terminalId -is [string]) {
        if ($planId -eq $terminalId) {
            Block "observed manifest invocationPlanEventId and terminalEventId must be distinct"
            $ok = $false
        } else {
            Pass "observed manifest event ids are distinct"
        }
    }

    return $ok
}

function Get-EntryString {
    param(
        [object]$Entry,
        [string[]]$Names
    )

    foreach ($name in $Names) {
        $prop = $Entry.PSObject.Properties[$name]
        if ($null -ne $prop -and $prop.Value -is [string] -and -not [string]::IsNullOrWhiteSpace($prop.Value)) {
            return [string]$prop.Value
        }
    }
    return $null
}

function Resolve-HashReferencedEventLog {
    param(
        [object]$Manifest,
        [string]$ExpectedHash,
        [string]$Root
    )

    $eventLogArtifact = Get-RequiredString $Manifest "eventLogArtifact" "observed manifest"
    $hashManifestRef = Get-RequiredString $Manifest "hashManifest" "observed manifest"
    if ($null -eq $eventLogArtifact -or $null -eq $hashManifestRef) {
        Block "sha256 references require eventLogArtifact and hashManifest future artifact schema fields"
        return $null
    }

    $hashManifestPath = Resolve-EvidencePath $hashManifestRef $Root "hash manifest"
    $hashManifest = Get-JsonFile $hashManifestPath "hash manifest"
    if ($null -eq $hashManifest) {
        return $null
    }

    $entries = if ($hashManifest -is [array]) {
        @($hashManifest)
    } elseif ($null -ne $hashManifest.PSObject.Properties["artifacts"]) {
        @($hashManifest.artifacts)
    } elseif ($null -ne $hashManifest.PSObject.Properties["sha256"]) {
        @($hashManifest)
    } else {
        @()
    }
    if ($entries.Count -eq 0) {
        Block "hash manifest contains no artifacts"
        return $null
    }

    $matchingEntry = $null
    foreach ($entry in $entries) {
        $entryName = Get-EntryString $entry @("path", "name")
        $entryHash = Get-EntryString $entry @("sha256", "hash")
        if ($entryName -eq $eventLogArtifact -and $entryHash.ToLowerInvariant() -eq $ExpectedHash.ToLowerInvariant()) {
            $matchingEntry = $entry
            break
        }
    }
    if ($null -eq $matchingEntry) {
        Block "hash manifest does not include eventLogArtifact with expected sha256"
        return $null
    }
    Pass "hash manifest includes eventLogArtifact and expected sha256"

    $eventLogPath = Resolve-EvidencePath $eventLogArtifact $Root "event log artifact"
    if ($null -eq $eventLogPath -or -not (Test-Path -LiteralPath $eventLogPath -PathType Leaf)) {
        Block "event log artifact not found for hash manifest"
        return $null
    }

    $actualHash = (Get-FileHash -LiteralPath $eventLogPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $ExpectedHash.ToLowerInvariant()) {
        Block "event log artifact sha256 does not match observedEvidenceRef"
        return $null
    }
    Pass "event log artifact sha256 matches observedEvidenceRef"

    $entryBytesProp = $matchingEntry.PSObject.Properties["bytes"]
    if ($null -ne $entryBytesProp) {
        $actualBytes = (Get-Item -LiteralPath $eventLogPath).Length
        if ([int64]$entryBytesProp.Value -eq $actualBytes) {
            Pass "event log artifact bytes match hash manifest"
        } else {
            Block "event log artifact bytes do not match hash manifest"
            return $null
        }
    }

    $script:HashVerified = $true
    return $eventLogPath
}

function Resolve-ObservedEvidenceEventLog {
    param(
        [object]$Manifest,
        [string]$Root
    )

    $observedEvidenceRef = Get-RequiredString $Manifest "observedEvidenceRef" "observed manifest"
    if ($null -eq $observedEvidenceRef) {
        return $null
    }

    if ($observedEvidenceRef -match '^(?:event-log|edge-event-log|artifact):(.+)$') {
        return Resolve-EvidencePath $Matches[1] $Root "event log artifact"
    }

    if ($observedEvidenceRef -match '^sha256:([a-fA-F0-9]{64})$') {
        return Resolve-HashReferencedEventLog $Manifest $Matches[1] $Root
    }

    Block "observed manifest observedEvidenceRef must be event-log:, edge-event-log:, artifact:, or sha256:"
    return $null
}

function Test-EventLogAgainstManifest {
    param(
        [object]$Manifest,
        [object]$EventLog
    )

    $events = Get-EventsFromLog $EventLog
    if ($events.Count -eq 0) {
        Block "event log contains no events"
        return $false
    }
    Pass "event log contains events"

    $adapterId = [string](Get-RequiredPropertyValue $Manifest "adapterId" "observed manifest")
    $correlationId = [string](Get-RequiredPropertyValue $Manifest "correlationId" "observed manifest")
    $planEventId = [string](Get-RequiredPropertyValue $Manifest "invocationPlanEventId" "observed manifest")
    $terminalEventId = [string](Get-RequiredPropertyValue $Manifest "terminalEventId" "observed manifest")

    $planEvent = Find-EventById $events $planEventId
    $terminalEvent = Find-EventById $events $terminalEventId

    $ok = $true
    if (-not (Test-EventCommonFields $planEvent "invocation plan event" $correlationId $adapterId)) {
        $ok = $false
    }
    if (-not (Test-EventCommonFields $terminalEvent "terminal event" $correlationId $adapterId)) {
        $ok = $false
    }

    if ($null -ne $planEvent) {
        $planType = Get-EventString $planEvent @("type", "eventType", "event_type")
        if ($planType -match 'cli_invocation_plan|invocation[_-]?plan') {
            Pass "invocation plan event type matches CLI plan"
        } else {
            Block "invocation plan event type is not a CLI invocation plan"
            $ok = $false
        }
    }

    if ($null -ne $terminalEvent) {
        $terminalStatus = Get-EventString $terminalEvent @("terminalStatus", "status")
        if ($terminalStatus -eq "finished") {
            Pass "terminal event terminalStatus=finished"
        } else {
            Block "terminal event terminalStatus is not finished"
            $ok = $false
        }

        $terminalExitCode = $terminalEvent.PSObject.Properties["exitCode"]
        if ($null -eq $terminalExitCode) {
            $terminalExitCode = $terminalEvent.PSObject.Properties["exit_code"]
        }
        if ($null -ne $terminalExitCode -and ($terminalExitCode.Value -is [int] -or $terminalExitCode.Value -is [long]) -and [long]$terminalExitCode.Value -eq 0) {
            Pass "terminal event exitCode=0"
        } else {
            Block "terminal event exitCode must be integer 0"
            $ok = $false
        }
    }

    return $ok
}

Write-Host "AgentHub approved-real Edge CLI evidence verifier" -ForegroundColor Magenta
Write-Host "No real CLI/model/login/network command was executed by this verifier." -ForegroundColor Magenta
Write-Host "This verifier distinguishes MockAdapterUsed, RealCliTested, RealModelTested, and TokenDanceIDLogin." -ForegroundColor Magenta

$approved = Test-ApprovalMarker
$manifestPath = if ([string]::IsNullOrWhiteSpace($ObservedManifest)) { "" } elseif ([System.IO.Path]::IsPathRooted($ObservedManifest)) { $ObservedManifest } else { Join-Path $RepoRoot $ObservedManifest }
$manifestPath = if ([string]::IsNullOrWhiteSpace($manifestPath)) { "" } else { [System.IO.Path]::GetFullPath($manifestPath) }
$manifest = Get-JsonFile $manifestPath "observed manifest"
$manifestOK = Test-ManifestShape $manifest

$evidenceBase = ""
if (-not [string]::IsNullOrWhiteSpace($EvidenceRoot)) {
    $evidenceBase = if ([System.IO.Path]::IsPathRooted($EvidenceRoot)) { $EvidenceRoot } else { Join-Path $RepoRoot $EvidenceRoot }
} elseif (-not [string]::IsNullOrWhiteSpace($manifestPath)) {
    $evidenceBase = Split-Path -Parent $manifestPath
}
$evidenceBase = if ([string]::IsNullOrWhiteSpace($evidenceBase)) { "" } else { [System.IO.Path]::GetFullPath($evidenceBase) }

$eventLogPath = $null
$eventLog = $null
if ($manifestOK -and -not [string]::IsNullOrWhiteSpace($evidenceBase)) {
    $eventLogPath = Resolve-ObservedEvidenceEventLog $manifest $evidenceBase
    if ($null -ne $eventLogPath) {
        $eventLog = Get-JsonFile $eventLogPath "event log"
    }
}

$eventLogOK = Test-EventLogAgainstManifest $manifest $eventLog
$verified = $approved -and $manifestOK -and $eventLogOK

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed  |  Blocks: $Blocks" -ForegroundColor $(if ($Failed -eq 0 -and $verified) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($verified) {
    Write-Host "real_tested=true" -ForegroundColor Green
    Write-Host "MockAdapterUsed=false" -ForegroundColor Green
    Write-Host "RealCliTested=true" -ForegroundColor Green
    Write-Host "RealModelTested=false" -ForegroundColor Green
    Write-Host "TokenDanceIDLogin=false" -ForegroundColor Green
    Write-Host "approved_real_evidence_verified=true" -ForegroundColor Green
    Write-Host "hash_verified=$($HashVerified.ToString().ToLowerInvariant())" -ForegroundColor Green
    Write-Host "Status: APPROVED_REAL_EVIDENCE_VERIFIED" -ForegroundColor Green
    exit $(if ($Failed -eq 0) { 0 } else { 1 })
}

Write-Host "real_tested=false" -ForegroundColor Yellow
Write-Host "MockAdapterUsed=unknown" -ForegroundColor Yellow
Write-Host "RealCliTested=false" -ForegroundColor Yellow
Write-Host "RealModelTested=false" -ForegroundColor Yellow
Write-Host "TokenDanceIDLogin=false" -ForegroundColor Yellow
Write-Host "approved_real_evidence_verified=false" -ForegroundColor Yellow
Write-Host "hash_verified=$($HashVerified.ToString().ToLowerInvariant())" -ForegroundColor Yellow
Write-Host "Status: APPROVED_REAL_EVIDENCE_BLOCKED" -ForegroundColor Red
exit 1
