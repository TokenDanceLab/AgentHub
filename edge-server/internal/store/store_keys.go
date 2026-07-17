package store

func threadPinKey(threadID, itemID string) string {
	return threadID + "\x00" + itemID
}

func runDiffFileKey(runID, path string) string {
	return runID + "\x00" + path
}
