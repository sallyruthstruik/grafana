#!/bin/bash

grunt;
go run build.go build;
rm server.zip;
zip -r server.zip bin conf public_gen;