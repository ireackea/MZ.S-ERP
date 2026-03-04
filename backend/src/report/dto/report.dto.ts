export class ReportDto {
  startDate?: string;
  endDate?: string;
  itemIds?: string[]; // publicId values from frontend
  partner?: string;
  page?: number;
  limit?: number;
}
