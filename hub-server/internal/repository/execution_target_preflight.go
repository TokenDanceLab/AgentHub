package repository

import "gorm.io/gorm"

type ActiveLocalEdgeDeviceDuplicate struct {
	OwnerID   string
	DeviceID  string
	TargetIDs []string
}

func FindActiveLocalEdgeDeviceDuplicates(db *gorm.DB) ([]ActiveLocalEdgeDeviceDuplicate, error) {
	type duplicateKey struct {
		OwnerID  string `gorm:"column:owner_id"`
		DeviceID string `gorm:"column:device_id"`
	}

	var keys []duplicateKey
	if err := db.Raw(`
		SELECT owner_id, device_id
		FROM execution_targets
		WHERE deleted_at IS NULL
		  AND target_type = ?
		  AND device_id IS NOT NULL
		GROUP BY owner_id, device_id
		HAVING COUNT(*) > 1
		ORDER BY owner_id ASC, device_id ASC
	`, "local_edge").Scan(&keys).Error; err != nil {
		return nil, err
	}

	duplicates := make([]ActiveLocalEdgeDeviceDuplicate, 0, len(keys))
	for _, key := range keys {
		var targetIDs []string
		if err := db.Table("execution_targets").
			Where("deleted_at IS NULL").
			Where("target_type = ?", "local_edge").
			Where("owner_id = ? AND device_id = ?", key.OwnerID, key.DeviceID).
			Order("id ASC").
			Pluck("id", &targetIDs).Error; err != nil {
			return nil, err
		}
		duplicates = append(duplicates, ActiveLocalEdgeDeviceDuplicate{
			OwnerID:   key.OwnerID,
			DeviceID:  key.DeviceID,
			TargetIDs: targetIDs,
		})
	}

	return duplicates, nil
}
