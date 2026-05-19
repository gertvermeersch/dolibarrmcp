Dolibarr MCP
============

This project is a TypeScript MCP server that exposes task-oriented Dolibarr ERP/CRM tools.
It connects to Dolibarr through the REST API and serves MCP over HTTP.


Setup
-----

1. Install dependencies:

   npm install

2. Create a local environment file:

   cp .env.example .env

3. Fill in these values:

   MCP_API_KEY        Secret expected from MCP clients in the X-API-Key header.
   DOLIBARR_URL       Full Dolibarr REST API base URL, for example:
                     http://host.docker.internal/api/index.php
   DOLIBARR_API_KEY   API token from the Dolibarr user account.
   MCP_HTTP_HOST      Defaults to 0.0.0.0.
   MCP_HTTP_PORT      Defaults to 3000.

4. Run locally:

   npm run dev

   Or with Docker:

   docker compose up


Dolibarr Requirements
---------------------

The Dolibarr instance must have the API REST module enabled.

The Dolibarr API token belongs to a normal Dolibarr user, so that user's permissions decide
what the MCP server can read or write. If a module is inactive or the user lacks rights,
Dolibarr often returns a generic 403 Forbidden response.

Important Products/Services note:

Dolibarr exposes products and services through the same REST endpoint:

   /products

The MCP tools hide that detail:

   search_products   Searches only products.
   search_services   Searches only services.

However, even service searches use Dolibarr's /products API internally with mode=2.
That means the Products/Services module and API endpoint must be enabled, even if you only
use services and never create products.

For service search to work, confirm in Dolibarr:

   - API REST module is enabled.
   - Products/Services module is enabled.
   - The API user has read permission for products/services.


Implemented Tools
-----------------

Read tools:

   search_products
   search_services

Write tools:

   create_thirdparty
   update_thirdparty
   create_invoice
   create_supplier_invoice
   create_proposal
   set_proposal_status

Some read tools are still stubs or planned work; see TODO.md for the current implementation
checklist.


Errors
------

Tool errors are returned as structured JSON. For example, when Dolibarr returns a 403 for a
known module endpoint, the server returns:

   {
     "error": "DOLIBARR_MODULE_UNAVAILABLE",
     "message": "Dolibarr refused access to the ... API. The module may be inactive or the API user may be missing permissions.",
     "action": "..."
   }

Because Dolibarr uses the same 403 shape for inactive modules and missing permissions, check
both when debugging access failures.
