import React from 'react';
import UnloadingRulesPanel from './UnloadingRulesPanel';

interface UnloadingRulesSettingsProps {
  forceAccess?: boolean;
}

const UnloadingRulesSettings: React.FC<UnloadingRulesSettingsProps> = ({ forceAccess = false }) => (
  <div className="space-y-6">
    <UnloadingRulesPanel forceAccess={forceAccess} />
  </div>
);

export default UnloadingRulesSettings;