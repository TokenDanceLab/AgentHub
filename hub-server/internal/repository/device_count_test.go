package repository

import (
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// newDeviceCountMock wires a sqlmock-backed GORM *gorm.DB (postgres dialect)
// for the device quota count queries.
func newDeviceCountMock(t *testing.T) (*gorm.DB, sqlmock.Sqlmock) {
	t.Helper()
	sqlDB, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	require.NoError(t, err)
	t.Cleanup(func() {
		mock.ExpectClose()
		require.NoError(t, sqlDB.Close())
		require.NoError(t, mock.ExpectationsWereMet())
	})

	db, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	require.NoError(t, err)
	return db, mock
}

func TestCountDevicesByUserAndType(t *testing.T) {
	db, mock := newDeviceCountMock(t)

	mock.ExpectQuery(`SELECT count\(\*\) FROM .?devices.? WHERE user_id = \$1 AND device_type = \$2`).
		WithArgs("user-a", "cloud_edge").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(7))

	count, err := CountDevicesByUserAndType(db, "user-a", "cloud_edge")
	require.NoError(t, err)
	require.Equal(t, int64(7), count)
}

func TestCountDevicesByUserAndTypeEmpty(t *testing.T) {
	db, mock := newDeviceCountMock(t)

	mock.ExpectQuery(`SELECT count\(\*\) FROM .?devices.? WHERE user_id = \$1 AND device_type = \$2`).
		WithArgs("user-empty", "cloud_edge").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	count, err := CountDevicesByUserAndType(db, "user-empty", "cloud_edge")
	require.NoError(t, err)
	require.Equal(t, int64(0), count)
}

func TestDeviceExistsForUser(t *testing.T) {
	db, mock := newDeviceCountMock(t)

	mock.ExpectQuery(`SELECT count\(\*\) FROM .?devices.? WHERE id = \$1 AND user_id = \$2 AND device_type = \$3`).
		WithArgs("device-1", "user-a", "cloud_edge").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	exists, err := DeviceExistsForUser(db, "device-1", "user-a", "cloud_edge")
	require.NoError(t, err)
	require.True(t, exists)
}

func TestDeviceExistsForUserMissing(t *testing.T) {
	db, mock := newDeviceCountMock(t)

	mock.ExpectQuery(`SELECT count\(\*\) FROM .?devices.? WHERE id = \$1 AND user_id = \$2 AND device_type = \$3`).
		WithArgs("device-x", "user-a", "cloud_edge").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	exists, err := DeviceExistsForUser(db, "device-x", "user-a", "cloud_edge")
	require.NoError(t, err)
	require.False(t, exists)
}
