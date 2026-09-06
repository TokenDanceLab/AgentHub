package store

// store_query_snapshot.go holds pure fileSnapshot build/materialize helpers
// extracted from store_query.go.

// buildFileSnapshot deep-copies maps/orders into a durable snapshot value.
func buildFileSnapshot(
	projects map[string]Project,
	threads map[string]Thread,
	runs map[string]Run,
	items map[string]Item,
	pins map[string]ThreadPin,
	diffs map[string]RunDiffFile,
	artifacts map[string]Artifact,
	previews map[string]Preview,
	checkpoints map[string]RunCheckpoint,
	userProfiles map[string]UserProfile,
	agentProfiles map[string]AgentProfile,
	projectOrder, threadOrder, runOrder, itemOrder, pinOrder, diffOrder, artifactOrder, previewOrder, userProfileOrder, agentProfileOrder []string,
	settings map[string]string,
	settingsMtime string,
) fileSnapshot {
	return fileSnapshot{
		Projects:          copyMap(projects),
		Threads:           copyMap(threads),
		Runs:              copyMap(runs),
		Items:             copyMap(items),
		Pins:              copyMap(pins),
		Diffs:             copyMap(diffs),
		Artifacts:         cloneArtifactMap(artifacts),
		Previews:          copyMap(previews),
		Checkpoints:       cloneCheckpointMap(checkpoints),
		UserProfiles:      copyMap(userProfiles),
		AgentProfiles:     cloneAgentProfileMap(agentProfiles),
		ProjectOrder:      append([]string(nil), projectOrder...),
		ThreadOrder:       append([]string(nil), threadOrder...),
		RunOrder:          append([]string(nil), runOrder...),
		ItemOrder:         append([]string(nil), itemOrder...),
		PinOrder:          append([]string(nil), pinOrder...),
		DiffOrder:         append([]string(nil), diffOrder...),
		ArtifactOrder:     append([]string(nil), artifactOrder...),
		PreviewOrder:      append([]string(nil), previewOrder...),
		UserProfileOrder:  append([]string(nil), userProfileOrder...),
		AgentProfileOrder: append([]string(nil), agentProfileOrder...),
		Settings:          copyMap(settings),
		SettingsMtime:     settingsMtime,
	}
}

// materializeFileSnapshot copies snapshot maps and normalizes order slices.
// Caller assigns the returned values under the store mutex.
// Settings are restored from the durable snapshot; a nil settings map becomes empty.
func materializeFileSnapshot(snapshot fileSnapshot) (
	projects map[string]Project,
	threads map[string]Thread,
	runs map[string]Run,
	items map[string]Item,
	pins map[string]ThreadPin,
	diffs map[string]RunDiffFile,
	artifacts map[string]Artifact,
	previews map[string]Preview,
	checkpoints map[string]RunCheckpoint,
	userProfiles map[string]UserProfile,
	agentProfiles map[string]AgentProfile,
	projectOrder, threadOrder, runOrder, itemOrder, pinOrder, diffOrder, artifactOrder, previewOrder, userProfileOrder, agentProfileOrder []string,
	settings map[string]string,
	settingsMtime string,
) {
	projects = copyMap(snapshot.Projects)
	threads = copyMap(snapshot.Threads)
	runs = copyMap(snapshot.Runs)
	items = copyMap(snapshot.Items)
	pins = copyMap(snapshot.Pins)
	diffs = copyMap(snapshot.Diffs)
	artifacts = cloneArtifactMap(snapshot.Artifacts)
	previews = copyMap(snapshot.Previews)
	checkpoints = cloneCheckpointMap(snapshot.Checkpoints)
	userProfiles = copyMap(snapshot.UserProfiles)
	agentProfiles = cloneAgentProfileMap(snapshot.AgentProfiles)
	projectOrder = normalizeOrder(snapshot.ProjectOrder, projects)
	threadOrder = normalizeOrder(snapshot.ThreadOrder, threads)
	runOrder = normalizeOrder(snapshot.RunOrder, runs)
	itemOrder = normalizeOrder(snapshot.ItemOrder, items)
	pinOrder = normalizeOrder(snapshot.PinOrder, pins)
	diffOrder = normalizeOrder(snapshot.DiffOrder, diffs)
	artifactOrder = normalizeOrder(snapshot.ArtifactOrder, artifacts)
	previewOrder = normalizeOrder(snapshot.PreviewOrder, previews)
	userProfileOrder = normalizeOrder(snapshot.UserProfileOrder, userProfiles)
	agentProfileOrder = normalizeOrder(snapshot.AgentProfileOrder, agentProfiles)
	settings = ensureSettingsMap(copyMap(snapshot.Settings))
	settingsMtime = snapshot.SettingsMtime
	return
}
