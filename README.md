# Udhaar-AI
Speak. Record. Collect.

An AI-powered voice-first credit management platform designed for small merchants, kirana stores, and local retailers.

UDHAARAI enables shop owners to manage customer credit (udhaar), collections, expenses, and business insights using natural voice commands instead of manual data entry.

---

Features

### Voice-Based Credit Entry

Record udhaar transactions through natural speech.

Example:

> "Add ₹500 udhaar for Ramesh."

### Collection Tracking

Instantly update repayments and customer balances.

Example:

> "Ramesh paid ₹300 today."

### AI Transaction Parsing

Uses LLM-powered intent extraction to automatically understand:

* Customer Name
* Amount
* Transaction Type
* Date & Time
* Context

### Smart Customer Management

* Duplicate customer prevention
* Customer ledger tracking
* Outstanding balance monitoring
* Transaction history

### Automated Reminders

Generate collection reminders for:

* Overdue payments
* High-risk customers
* Pending balances

### Business Insights Dashboard

Track:

* Total Outstanding Credit
* Daily Collections
* Monthly Revenue
* Top Debtors
* Customer Payment Trends

### Expense Recording

Track business expenses using voice.

Example:

> "Record ₹2,000 inventory expense."

---

System Architecture

```text
Merchant Voice Input
          │
          ▼
Speech-to-Text Engine
          │
          ▼
AI Intent Extraction
          │
          ▼
Transaction Validation
          │
          ▼
Customer Matching
          │
          ▼
Ledger Management
          │
          ▼
Insights & Notifications
```

Technology Stack

### Frontend

* React
* TypeScript
* Vite
* HTML5
* Tailwind CSS
* LocalStorage

### Backend

* Node.js
* Express.js
* RESTful APIs
* JSON-based Persistent File System Database

### AI & Integrations

* Gemini AI SDK
* Google Generative AI API
* Voice-to-Transaction Parsing
* LLM-Driven Daily Summaries
* REST API Integrations

### Developer Tools

* Git
* npm
* PowerShell
* Vitest
* Jest

---

Getting Started

### Clone Repository

```bash
git clone https://github.com/your-username/udhaarai.git
cd udhaarai
```

### Install Dependencies

```bash
npm install
```

### Start Development Server

```bash
npm run dev
```

### Start Backend Server

```bash
npm run server
```

---

Future Roadmap

* Multi-language Voice Support
* WhatsApp Integration
* Predictive Collection Analytics
* AI Cashflow Forecasting
* Supplier Management
* Automated Business Reports

---

Problem Statement

Small merchants lose time and revenue because credit transactions are often tracked manually.

UDHAARAI transforms credit management into a simple conversation, reducing operational friction and helping merchants focus on growing their businesses.

---

Team

**Aditi Sinha**
Product Strategy & User Experience

**Rishabh Raj**
Product Design, Business Strategy & AI Architecture

**Sanskriti**
Research, Analysis & Solution Development

---

Built For

OKCredit Problem Solving Challenge

**UDHAARAI — Speak. Record. Collect.**
