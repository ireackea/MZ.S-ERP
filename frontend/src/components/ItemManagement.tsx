import React from 'react';
import ItemsPage from '../pages/Items';
import type { Tag, Transaction } from '../types';

export interface ItemManagementProps {
  transactions: Transaction[];
  availableTags: Tag[];
}

const ItemManagement: React.FC<ItemManagementProps> = () => <ItemsPage />;

export default ItemManagement;