package adapters

import "bufio"

const (
	adapterScannerInitialBufferSize = 256 * 1024
	adapterScannerMaxTokenSize      = 10 * 1024 * 1024
)

func configureAdapterScanner(scanner *bufio.Scanner) {
	scanner.Buffer(make([]byte, 0, adapterScannerInitialBufferSize), adapterScannerMaxTokenSize)
}
