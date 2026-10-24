---
title: "Payments need proof, not just a success page"
description: "Why a verified event should be the source of truth for paid access."
date: "2026-10-16"
category: "Engineering"
image: "/og.png"
published: true
---

## Separate checkout from entitlement

A checkout creates a payment attempt. It does not create an entitlement. The browser can close, a callback can arrive late, and a webhook can be delivered more than once.

The durable record should make duplicate events harmless and keep every checkout tied to its original account. The success page then checks that exact attempt instead of searching for any historical payment.

## Make it yours

This article is original sample content for SaaSStarterKit. Adapt it to your product, your users, and the choices you make.
