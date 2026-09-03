package repository

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"gorm.io/gorm"
)

func TestWrapNotFound(t *testing.T) {
	mappedErr := errors.New("mapped not found")

	assert.NoError(t, WrapNotFound(nil, mappedErr))
	assert.ErrorIs(t, WrapNotFound(gorm.ErrRecordNotFound, mappedErr), mappedErr)
	assert.ErrorIs(t, WrapNotFound(errors.Join(errors.New("lookup failed"), gorm.ErrRecordNotFound), mappedErr), mappedErr)

	otherErr := errors.New("other")
	assert.ErrorIs(t, WrapNotFound(otherErr, mappedErr), otherErr)
}
