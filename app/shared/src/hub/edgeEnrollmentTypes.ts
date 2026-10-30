/** Public enrollment metadata. Device credentials are never returned to a browser. */
export interface HubEdgeEnrollmentPreview {
  enrollment_id: string;
  name: string;
  device_id: string;
  runtime_id: string;
  workspace_root: string;
  expires_at: string;
  status: string;
}

export interface HubEdgeEnrollmentConfirmation extends Omit<HubEdgeEnrollmentPreview, 'status'> {
  status: 'confirmed';
}

export interface HubEdgeDeviceRevocation { revoked: true }
