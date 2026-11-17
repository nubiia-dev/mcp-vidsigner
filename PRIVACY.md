# Privacy Policy

**Last Updated**: November 17, 2026

This Privacy Policy describes how the MCP VIDsigner server ("the Server", "we", "our") handles data when you use it to connect your AI assistant to the VIDsigner API of Validated ID.

## 1. Overview

The MCP VIDsigner server is an open-source Model Context Protocol (MCP) server that acts as a bridge between AI assistants (like Claude) and the VIDsigner API. This server runs locally on your machine and does not operate any cloud services or remote servers that process your data. This project is unofficial and is not affiliated with Validated ID.

## 2. Data Collection

### 2.1 What Data the Server Processes

- **VIDsigner credentials**: your subscription name and password, and optionally your OAuth client ID and secret and partner credentials, provided through environment variables
- **Request data**: the documents, signer names, email addresses, phone numbers and other fields you or your AI assistant send through the Server
- **Response data**: documents, evidence reports, statuses and other information returned by VIDsigner
- **Source IP in the document log**: VIDsigner records every API call on a document, reads included, in the document log (`GET /documents/{id}/loginfo`, tool `vidsigner_get_document_log`) together with the IP of the client that made it. Anyone who can see that log sees the IP addresses of the machines that run this Server.

### 2.2 How Data is Used

The Server forwards your requests to the VIDsigner API and returns the responses to your AI assistant. Files you download (signed PDFs, reports, certificates) are written to a local folder on your machine that you control (`VIDSIGNER_OUTPUT_DIR`).

## 3. Data Storage and Sharing

- The Server does not store your data on any remote server, does not include analytics or telemetry, and does not share data with Nubiia or any third party
- Credentials are read from environment variables and are never written to logs
- Data sent to VIDsigner is processed by Validated ID under its own terms and privacy policy
- Data returned to your AI assistant is processed by the provider of that assistant under its own terms

## 4. Your Responsibility

You are responsible for the lawful processing of the personal data of the signers and recipients you send through the Server, and for configuring the recipient allow-lists appropriately.

## 5. Contact

Questions about this policy: hola@nubiia.es
