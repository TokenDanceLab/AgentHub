package repository

import "gorm.io/gorm"

type ActiveLocalEdgeDeviceDuplicate struct {
	OwnerID   string
	DeviceID  string
	TargetIDs []string
}

func FindActiveLocalEdgeDeviceDuplicates(db *gorm.DB) ([]ActiveLocalEdgeDeviceDuplicate, error) {
	// Single query + in-Go grouping (#2102 item 14): the previous version
	// issued one Pluck per duplicate key — an N+1 pattern that grows with the
	// number of conflicted (owner, device) groups. One round-trip now fetches
	// every active local_edge row and grouping happens in memory; duplicate
	// groups are expected to be rare, so the memory cost is negligible.
	type targetRow struct {
		ID       string `gorm:"column:id"`
		OwnerID  string `gorm:"column:owner_id"`
		DeviceID string `gorm:"column:device_id"`
	}
	var rows []targetRow
	if err := db.Table("execution_targets").
		Select("id, owner_id, device_id").
		Where("deleted_at IS NULL").
		Where("target_type = ?", "local_edge").
		Where("device_id IS NOT NULL").
		Order("owner_id ASC, device_id ASC, id ASC").
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	type groupKey struct{ ownerID, deviceID string }
	idsByGroup := make(map[groupKey][]string, len(rows))
	var order []groupKey
	seen := make(map[groupKey]bool, len(rows))
	for _, r := range rows {
		k := groupKey{r.OwnerID, r.DeviceID}
		idsByGroup[k] = append(idsByGroup[k], r.ID)
		if !seen[k] {
			seen[k] = true
			order = append(order, k)
		}
	}

	duplicates := make([]ActiveLocalEdgeDeviceDuplicate, 0)
	for _, k := range order {
		ids := idsByGroup[k]
		if len(ids) < 2 {
			continue
		}
		duplicates = append(duplicates, ActiveLocalEdgeDeviceDuplicate{
			OwnerID:   k.ownerID,
			DeviceID:  k.deviceID,
			TargetIDs: ids,
		})
	}
	return duplicates, nil
}
