import React from 'react';
import UnloadingRulesPanel from './UnloadingRulesPanel';

interface UnloadingRulesSettingsProps {
}

const UnloadingRulesSettings: React.FC<UnloadingRulesSettingsProps> = ({ }) => (
  <div className="space-y-6">
    <UnloadingRulesPanel />
  </div>
);

export default UnloadingRulesSettings;