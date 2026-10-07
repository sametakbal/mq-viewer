#!/usr/bin/env bash
# Regenerates the keystores used by TlsFactoryTest (password "changeit", valid 100 years).
#   ca.p12      self-signed test CA
#   server.p12  "server" key, chain server -> CA
#   client.p12  "client" and "other" keys, both issued by the CA
#   trust.jks   the CA certificate only (JKS)
#   leaf.p12    a server certificate whose CA is in no truststore
set -euo pipefail
cd "$(dirname "$0")"
rm -f ./*.p12 ./*.jks ./*.pem ./*.csr
P=changeit
kt() { keytool -noprompt -storepass $P -keypass $P "$@"; }

kt -genkeypair -alias ca -keyalg EC -groupname secp256r1 -dname "CN=Test CA" -ext bc:c -validity 36500 -keystore ca.p12 -storetype PKCS12
kt -exportcert -rfc -alias ca -keystore ca.p12 -file ca.pem

issue() { # store alias cn
  kt -genkeypair -alias "$2" -keyalg EC -groupname secp256r1 -dname "CN=$3" -validity 36500 -keystore "$1" -storetype PKCS12
  kt -certreq -alias "$2" -keystore "$1" -file "$2.csr"
  kt -gencert -alias ca -keystore ca.p12 -infile "$2.csr" -outfile "$2.pem" -rfc -validity 36500 -ext san=dns:localhost
  kt -importcert -alias ca -keystore "$1" -file ca.pem
  cat "$2.pem" ca.pem > "$2-chain.pem"
  kt -importcert -alias "$2" -keystore "$1" -file "$2-chain.pem"
  kt -delete -alias ca -keystore "$1"
}
issue server.p12 server localhost
issue client.p12 client "MQ Client"
issue client.p12 other "Other Client"
kt -importcert -alias ca -file ca.pem -keystore trust.jks -storetype JKS

# A certificate from a CA nobody trusts.
kt -genkeypair -alias rogue -keyalg EC -groupname secp256r1 -dname "CN=Rogue CA" -ext bc:c -validity 36500 -keystore leaf.p12 -storetype PKCS12
kt -genkeypair -alias leaf -keyalg EC -groupname secp256r1 -dname "CN=leaf" -validity 36500 -keystore leaf.p12 -storetype PKCS12
kt -certreq -alias leaf -keystore leaf.p12 -file leaf.csr
kt -gencert -alias rogue -keystore leaf.p12 -infile leaf.csr -outfile leaf.pem -rfc -validity 36500
kt -exportcert -rfc -alias rogue -keystore leaf.p12 -file rogue.pem
cat leaf.pem rogue.pem > leaf-chain.pem
kt -importcert -alias leaf -keystore leaf.p12 -file leaf-chain.pem
kt -delete -alias rogue -keystore leaf.p12

rm -f ./*.pem ./*.csr
