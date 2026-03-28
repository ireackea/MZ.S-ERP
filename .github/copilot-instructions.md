Project Instructions for GitHub Copilot

Project Context

You are helping build an Enterprise Warehouse & Production System 4.0.The system follows strict architectural patterns: Separation of Concerns, Modular Monolith, and Clean Architecture.

Coding Standards

Frontend: Use modern frameworks (e.g., React, Vue) with a focus on responsive design (Mobile/Tablet first).
Backend: Use secure, scalable code. Avoid N+1 queries. Use prepared statements to prevent SQL injection.
Styling: Use utility-first CSS (Tailwind) or Grid/Flexbox. No legacy CSS.
Printing: Print logic should aim for pixel-perfect output. Use Puppeteer or similar libraries for PDF generation.

Specific Modules Logic

Stocktaking: When writing stocktaking logic, apply "Blind Count" logic (hide system quantity during entry).
Backup: Backup functions must be asynchronous (Background Jobs) to avoid blocking the main thread.
Calculations: Any weight calculation (Gross/Net/Tare) must handle day-rollover correctly (e.g., if exit_time < entry_time, add 24 hours).

Response Style

Provide clean, commented, and production-ready code.
Suggest modern libraries (e.g., use date-fns for dates, not moment.js).
Prioritize performance and security.
