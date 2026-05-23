package uuidv7

import "github.com/google/uuid"

func New() (string, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return "", err
	}
	return id.String(), nil
}
func Must() string { id, _ := New(); return id }
