# Desktop Frontend Infinite Re-render Fix

## Issue
Fixed "Maximum update depth exceeded" infinite re-render loop that occurred when starting the desktop application.

## Changes Made

1. **App.tsx** - Added safeguard to prevent IM view when not authenticated
2. **App.tsx** - Added conditional rendering for IM view based on authentication state
3. **useAuth.ts** - Improved auth state comparison to prevent unnecessary re-renders
4. **IMView.tsx** - Added authentication check and reset logic

## Result
The desktop application should now start without the infinite re-render error, while preserving all intended functionality for view switching and Hub authentication.