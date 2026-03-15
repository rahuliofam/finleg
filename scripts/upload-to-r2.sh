#!/bin/bash
# Upload accounting files to Cloudflare R2 with rich metadata
# Usage: ./scripts/upload-to-r2.sh [--dry-run]

set -euo pipefail

SRC="/Users/rahulio/Documents/CodingProjects/noncode/Finleg/AI Financial/Current Sonnad Accounting Files - Amanda 2022+"
DRY_RUN="${1:-}"
UPLOADED=0
FAILED=0
SKIPPED=0

log() { echo "[$(date +%H:%M:%S)] $*"; }

# Determine bucket and R2 path prefix based on source folder
get_routing() {
  local relpath="$1"
  local top_dir
  top_dir=$(echo "$relpath" | cut -d'/' -f1)

  # Default
  BUCKET="financial-statements"
  R2_PREFIX=""
  CATEGORY=""
  ACCOUNT_TYPE=""
  INSTITUTION=""
  ACCOUNT_NAME=""
  ACCOUNT_NUMBER=""
  ACCOUNT_HOLDER=""
  IS_CLOSED="false"
  PROPERTY=""
  CONVERTIBLE="false"

  case "$top_dir" in
    "Amex Blue Preferred (24006) Rahul"*)
      R2_PREFIX="credit-cards/amex-blue-preferred-24006"
      CATEGORY="statement"; ACCOUNT_TYPE="credit-card"; INSTITUTION="amex"
      ACCOUNT_NAME="Amex Blue Preferred"; ACCOUNT_NUMBER="24006"; ACCOUNT_HOLDER="Rahul"
      ;;
    "Amex Blue Business (11003)"*)
      R2_PREFIX="credit-cards/amex-blue-business-11003"
      CATEGORY="statement"; ACCOUNT_TYPE="credit-card"; INSTITUTION="amex"
      ACCOUNT_NAME="Amex Blue Business"; ACCOUNT_NUMBER="11003"; ACCOUNT_HOLDER="Rahul"
      ;;
    "Apple Card (2202)"*)
      R2_PREFIX="credit-cards/apple-card-2202"
      CATEGORY="statement"; ACCOUNT_TYPE="credit-card"; INSTITUTION="apple"
      ACCOUNT_NAME="Apple Card"; ACCOUNT_NUMBER="2202"; ACCOUNT_HOLDER="Rahul"
      ;;
    "Chase Amazon CC (4206)"*)
      R2_PREFIX="credit-cards/chase-amazon-cc-4206"
      CATEGORY="statement"; ACCOUNT_TYPE="credit-card"; INSTITUTION="chase"
      ACCOUNT_NAME="Chase Amazon CC"; ACCOUNT_NUMBER="4206"; ACCOUNT_HOLDER="Rahul"
      ;;
    "Chase Visa CC (7191)"*)
      R2_PREFIX="credit-cards/chase-visa-cc-7191"
      CATEGORY="statement"; ACCOUNT_TYPE="credit-card"; INSTITUTION="chase"
      ACCOUNT_NAME="Chase Visa CC"; ACCOUNT_NUMBER="7191"; ACCOUNT_HOLDER="Subhash"
      ;;
    "Bank of America CC (6420)"*)
      R2_PREFIX="credit-cards/boa-cc-6420"
      CATEGORY="statement"; ACCOUNT_TYPE="credit-card"; INSTITUTION="bank-of-america"
      ACCOUNT_NAME="Bank of America CC"; ACCOUNT_NUMBER="6420"; ACCOUNT_HOLDER="Subhash"
      ;;
    "Robinhood Gold Card (3892)"*)
      R2_PREFIX="credit-cards/robinhood-gold-card-3892"
      CATEGORY="statement"; ACCOUNT_TYPE="credit-card"; INSTITUTION="robinhood"
      ACCOUNT_NAME="Robinhood Gold Card"; ACCOUNT_NUMBER="3892"; ACCOUNT_HOLDER="Rahul"
      ;;
    "CS Checking (3711)"*)
      R2_PREFIX="bank-accounts/schwab-checking-3711"
      CATEGORY="statement"; ACCOUNT_TYPE="checking"; INSTITUTION="charles-schwab"
      ACCOUNT_NAME="CS Checking"; ACCOUNT_NUMBER="3711"; ACCOUNT_HOLDER="Rahul"
      ;;
    "US Bank (7444)"*)
      R2_PREFIX="bank-accounts/us-bank-checking-7444"
      CATEGORY="statement"; ACCOUNT_TYPE="checking"; INSTITUTION="us-bank"
      ACCOUNT_NAME="US Bank Checking"; ACCOUNT_NUMBER="7444"; ACCOUNT_HOLDER="Rahul"
      ;;
    "Cash App"*)
      R2_PREFIX="bank-accounts/cash-app"
      CATEGORY="statement"; ACCOUNT_TYPE="payment"; INSTITUTION="cash-app"
      ACCOUNT_NAME="Cash App"; ACCOUNT_NUMBER=""; ACCOUNT_HOLDER="Rahul"
      ;;
    "Venmo"*)
      R2_PREFIX="bank-accounts/venmo"
      CATEGORY="statement"; ACCOUNT_TYPE="payment"; INSTITUTION="venmo"
      ACCOUNT_NAME="Venmo"; ACCOUNT_NUMBER=""; ACCOUNT_HOLDER="Rahul"
      ;;
    "Paypal"*)
      R2_PREFIX="bank-accounts/paypal"
      CATEGORY="statement"; ACCOUNT_TYPE="payment"; INSTITUTION="paypal"
      ACCOUNT_NAME="PayPal"; ACCOUNT_NUMBER=""; ACCOUNT_HOLDER="Rahul"
      ;;
    "CS Brokerage (0566)"*)
      R2_PREFIX="brokerage/schwab-brokerage-0566"
      CATEGORY="statement"; ACCOUNT_TYPE="brokerage"; INSTITUTION="charles-schwab"
      ACCOUNT_NAME="CS Brokerage"; ACCOUNT_NUMBER="0566"; ACCOUNT_HOLDER="Rahul"
      ;;
    "CS Brokerage (2028)"*)
      R2_PREFIX="brokerage/schwab-brokerage-2028"
      CATEGORY="statement"; ACCOUNT_TYPE="brokerage"; INSTITUTION="charles-schwab"
      ACCOUNT_NAME="CS Brokerage"; ACCOUNT_NUMBER="2028"; ACCOUNT_HOLDER="Subhash"
      ;;
    "CS Trading (2192)"*)
      R2_PREFIX="brokerage/schwab-trading-2192"
      CATEGORY="statement"; ACCOUNT_TYPE="brokerage"; INSTITUTION="charles-schwab"
      ACCOUNT_NAME="CS Trading"; ACCOUNT_NUMBER="2192"; ACCOUNT_HOLDER="Rahul"
      ;;
    "CS IRA (3902)"*)
      R2_PREFIX="brokerage/schwab-ira-3902"
      CATEGORY="statement"; ACCOUNT_TYPE="ira"; INSTITUTION="charles-schwab"
      ACCOUNT_NAME="CS IRA"; ACCOUNT_NUMBER="3902"; ACCOUNT_HOLDER="Rahul"
      ;;
    "CS Trust (0044)"*)
      R2_PREFIX="brokerage/schwab-trust-0044"
      CATEGORY="statement"; ACCOUNT_TYPE="trust"; INSTITUTION="charles-schwab"
      ACCOUNT_NAME="CS Trust"; ACCOUNT_NUMBER="0044"; ACCOUNT_HOLDER="Trust"
      ;;
    "Coinbase"*)
      R2_PREFIX="brokerage/coinbase"
      CATEGORY="statement"; ACCOUNT_TYPE="crypto"; INSTITUTION="coinbase"
      ACCOUNT_NAME="Coinbase"; ACCOUNT_NUMBER=""; ACCOUNT_HOLDER="Rahul"
      ;;
    "Robinhood  - Roth IRA"*)
      R2_PREFIX="brokerage/robinhood-ira-8249-2310"
      CATEGORY="statement"; ACCOUNT_TYPE="ira"; INSTITUTION="robinhood"
      ACCOUNT_NAME="Robinhood Roth IRA & Traditional IRA"; ACCOUNT_NUMBER="8249/2310"; ACCOUNT_HOLDER="Rahul"
      ;;
    "Robinhood Consolidated IRA"*)
      R2_PREFIX="brokerage/robinhood-consolidated-ira"
      CATEGORY="statement"; ACCOUNT_TYPE="ira"; INSTITUTION="robinhood"
      ACCOUNT_NAME="Robinhood Consolidated IRA"; ACCOUNT_NUMBER=""; ACCOUNT_HOLDER="Rahul"
      ;;
    "PNC Mortgage"*)
      R2_PREFIX="loans/pnc-mortgage"
      CATEGORY="statement"; ACCOUNT_TYPE="mortgage"; INSTITUTION="pnc"
      ACCOUNT_NAME="PNC Mortgage"; ACCOUNT_NUMBER=""; ACCOUNT_HOLDER="Rahul"
      ;;
    "US Bank Equity (9078)"*)
      R2_PREFIX="loans/us-bank-equity-9078"
      CATEGORY="statement"; ACCOUNT_TYPE="heloc"; INSTITUTION="us-bank"
      ACCOUNT_NAME="US Bank Equity Line"; ACCOUNT_NUMBER="9078"; ACCOUNT_HOLDER="Rahul"
      ;;
    "US Bank Overdraft Credit Line (3784)"*)
      R2_PREFIX="loans/us-bank-overdraft-3784"
      CATEGORY="statement"; ACCOUNT_TYPE="credit-line"; INSTITUTION="us-bank"
      ACCOUNT_NAME="US Bank Overdraft Credit Line"; ACCOUNT_NUMBER="3784"; ACCOUNT_HOLDER="Rahul"
      ;;
    "Auto Loans"*)
      R2_PREFIX="loans/auto-loans"
      CATEGORY="statement"; ACCOUNT_TYPE="auto-loan"; INSTITUTION="various"
      ACCOUNT_NAME="Auto Loans"; ACCOUNT_NUMBER=""; ACCOUNT_HOLDER="Rahul"
      ;;
    "SBA Loan 4469264009"*)
      R2_PREFIX="loans/sba-4469264009-physical-business"
      CATEGORY="statement"; ACCOUNT_TYPE="sba-loan"; INSTITUTION="sba"
      ACCOUNT_NAME="SBA Physical Business Disaster Loan"; ACCOUNT_NUMBER="4469264009"; ACCOUNT_HOLDER="Family"
      ;;
    "SBA Loan 9663307809"*)
      R2_PREFIX="loans/sba-9663307809-covid-injury"
      CATEGORY="statement"; ACCOUNT_TYPE="sba-loan"; INSTITUTION="sba"
      ACCOUNT_NAME="SBA COVID-19 Economic Injury Loan"; ACCOUNT_NUMBER="9663307809"; ACCOUNT_HOLDER="Tesloop"
      ;;
    "Taxes"*)
      R2_PREFIX="taxes"
      BUCKET="bookkeeping-docs"
      CATEGORY="tax"; ACCOUNT_TYPE="tax"; INSTITUTION="irs"
      ACCOUNT_NAME="Taxes"; ACCOUNT_NUMBER=""; ACCOUNT_HOLDER="Family"
      ;;
    "Insurance Policies"*)
      R2_PREFIX="insurance"
      BUCKET="bookkeeping-docs"
      CATEGORY="insurance"; ACCOUNT_TYPE="insurance"; INSTITUTION="various"
      ACCOUNT_NAME="Insurance Policies"; ACCOUNT_NUMBER=""; ACCOUNT_HOLDER="Family"
      ;;
    "AAP"*)
      R2_PREFIX="property/alpaca-playhouse"
      BUCKET="bookkeeping-docs"
      CATEGORY="property-expense"; ACCOUNT_TYPE="property"; INSTITUTION="various"
      ACCOUNT_NAME="Alpaca Playhouse"; ACCOUNT_NUMBER=""; ACCOUNT_HOLDER="Family"
      PROPERTY="alpaca-playhouse"
      ;;
    "WA House"*)
      R2_PREFIX="property/wa-sharingwood"
      BUCKET="bookkeeping-docs"
      CATEGORY="property-expense"; ACCOUNT_TYPE="property"; INSTITUTION="various"
      ACCOUNT_NAME="WA Sharingwood House"; ACCOUNT_NUMBER=""; ACCOUNT_HOLDER="Family"
      PROPERTY="wa-sharingwood"
      ;;
    "Rahul"*"Credit"*)
      R2_PREFIX="credit-reports"
      BUCKET="bookkeeping-docs"
      CATEGORY="credit-report"; ACCOUNT_TYPE="credit-report"; INSTITUTION="various"
      ACCOUNT_NAME="Rahul Credit Reports"; ACCOUNT_NUMBER=""; ACCOUNT_HOLDER="Rahul"
      ;;
    "X Closed Accounts"*)
      R2_PREFIX="closed-accounts"
      CATEGORY="statement"; ACCOUNT_TYPE="closed"; INSTITUTION="various"
      ACCOUNT_NAME="Closed Accounts"; ACCOUNT_NUMBER=""; ACCOUNT_HOLDER="various"
      IS_CLOSED="true"
      ;;
    "Quickbooks Backups"*)
      R2_PREFIX="quickbooks"
      BUCKET="bookkeeping-docs"
      CATEGORY="backup"; ACCOUNT_TYPE="accounting-software"; INSTITUTION="quickbooks"
      ACCOUNT_NAME="QuickBooks Backups"; ACCOUNT_NUMBER=""; ACCOUNT_HOLDER="Family"
      ;;
    "AI Analysis Docs"*)
      R2_PREFIX="ai-analysis"
      BUCKET="bookkeeping-docs"
      CATEGORY="analysis"; ACCOUNT_TYPE="analysis"; INSTITUTION="internal"
      ACCOUNT_NAME="AI Analysis"; ACCOUNT_NUMBER=""; ACCOUNT_HOLDER="Rahul"
      ;;
    *)
      # Root-level files (spreadsheets, docx)
      R2_PREFIX="reference-spreadsheets"
      BUCKET="bookkeeping-docs"
      CATEGORY="reference"; ACCOUNT_TYPE="summary"; INSTITUTION="internal"
      ACCOUNT_NAME="Master Reference Files"; ACCOUNT_NUMBER=""; ACCOUNT_HOLDER="Family"
      CONVERTIBLE="true"
      ;;
  esac
}

# Extract date info from filename
extract_date() {
  local filename="$1"
  YEAR=""; MONTH=""; STATEMENT_DATE=""

  # Pattern: YYYY-MM-DD or YYYYMMDD
  if [[ "$filename" =~ ([0-9]{4})-([0-9]{2})-([0-9]{2}) ]]; then
    YEAR="${BASH_REMATCH[1]}"; MONTH="${BASH_REMATCH[2]}"
    STATEMENT_DATE="${BASH_REMATCH[1]}-${BASH_REMATCH[2]}-${BASH_REMATCH[3]}"
  elif [[ "$filename" =~ ([0-9]{4})([0-9]{2})([0-9]{2}) ]]; then
    YEAR="${BASH_REMATCH[1]}"; MONTH="${BASH_REMATCH[2]}"
    STATEMENT_DATE="${BASH_REMATCH[1]}-${BASH_REMATCH[2]}-${BASH_REMATCH[3]}"
  # Pattern: MM-DD-YYYY
  elif [[ "$filename" =~ ([0-9]{2})-([0-9]{2})-([0-9]{4}) ]]; then
    MONTH="${BASH_REMATCH[1]}"; YEAR="${BASH_REMATCH[3]}"
    STATEMENT_DATE="${BASH_REMATCH[3]}-${BASH_REMATCH[1]}-${BASH_REMATCH[2]}"
  fi

  # Try to get year from path if not in filename
  if [ -z "$YEAR" ]; then
    local dirpart
    dirpart=$(dirname "$relpath")
    if [[ "$dirpart" =~ (20[0-9]{2}) ]]; then
      YEAR="${BASH_REMATCH[1]}"
    fi
  fi
}

get_content_type() {
  local ext="${1##*.}"
  ext=$(echo "$ext" | tr '[:upper:]' '[:lower:]')
  case "$ext" in
    pdf)  echo "application/pdf" ;;
    xlsx) echo "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ;;
    xls)  echo "application/vnd.ms-excel" ;;
    csv)  echo "text/csv" ;;
    docx) echo "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ;;
    doc)  echo "application/msword" ;;
    jpg|jpeg) echo "image/jpeg" ;;
    png)  echo "image/png" ;;
    htm|html) echo "text/html" ;;
    zip)  echo "application/zip" ;;
    msg)  echo "application/vnd.ms-outlook" ;;
    *)    echo "application/octet-stream" ;;
  esac
}

upload_file() {
  local filepath="$1"
  local relpath="$2"

  get_routing "$relpath"
  extract_date "$(basename "$relpath")"

  local filename
  filename=$(basename "$relpath")
  local ext="${filename##*.}"
  ext=$(echo "$ext" | tr '[:upper:]' '[:lower:]')

  # Build R2 object key
  local r2_key
  # Strip the top-level folder from relpath to get sub-path
  local subpath
  subpath=$(echo "$relpath" | cut -d'/' -f2-)
  if [ "$subpath" = "$relpath" ]; then
    # Root-level file (no subfolder)
    r2_key="${R2_PREFIX}/${filename}"
  else
    # Clean up the subpath (replace spaces with hyphens, lowercase)
    r2_key="${R2_PREFIX}/${subpath}"
  fi

  local content_type
  content_type=$(get_content_type "$filename")

  # Build metadata header string
  local meta=""
  meta="category=${CATEGORY}"
  meta="${meta},account_type=${ACCOUNT_TYPE}"
  meta="${meta},institution=${INSTITUTION}"
  [ -n "$ACCOUNT_NAME" ] && meta="${meta},account_name=${ACCOUNT_NAME}"
  [ -n "$ACCOUNT_NUMBER" ] && meta="${meta},account_number=${ACCOUNT_NUMBER}"
  [ -n "$ACCOUNT_HOLDER" ] && meta="${meta},account_holder=${ACCOUNT_HOLDER}"
  [ -n "$YEAR" ] && meta="${meta},year=${YEAR}"
  [ -n "$MONTH" ] && meta="${meta},month=${MONTH}"
  [ -n "$STATEMENT_DATE" ] && meta="${meta},statement_date=${STATEMENT_DATE}"
  meta="${meta},file_type=${ext}"
  meta="${meta},is_closed=${IS_CLOSED}"
  [ -n "$PROPERTY" ] && meta="${meta},property=${PROPERTY}"
  [ "$CONVERTIBLE" = "true" ] && meta="${meta},convertible=true"
  meta="${meta},original_path=${relpath}"

  if [ "$DRY_RUN" = "--dry-run" ]; then
    echo "DRY-RUN: ${BUCKET} <- ${r2_key} [${content_type}] meta: ${meta}"
    return
  fi

  if wrangler r2 object put "${BUCKET}/${r2_key}" \
    --file="$filepath" \
    --content-type="$content_type" \
    --custom-metadata="${meta}" \
    2>/dev/null; then
    UPLOADED=$((UPLOADED + 1))
    if [ $((UPLOADED % 50)) -eq 0 ]; then
      log "Uploaded ${UPLOADED} files..."
    fi
  else
    log "FAILED: ${filepath}"
    FAILED=$((FAILED + 1))
  fi
}

# Main
log "Starting upload from: $SRC"
log "Mode: ${DRY_RUN:-LIVE}"

# Process all files
find "$SRC" -type f -print0 | while IFS= read -r -d '' filepath; do
  # Get path relative to SRC
  relpath="${filepath#$SRC/}"

  # Skip .DS_Store and other system files
  filename=$(basename "$relpath")
  if [[ "$filename" == .DS_Store ]] || [[ "$filename" == .* ]]; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  upload_file "$filepath" "$relpath"
done

log "=== UPLOAD COMPLETE ==="
log "Uploaded: ${UPLOADED}"
log "Failed:   ${FAILED}"
log "Skipped:  ${SKIPPED}"
