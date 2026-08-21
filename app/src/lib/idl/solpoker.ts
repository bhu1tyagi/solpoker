/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/solpoker.json`.
 */
export type Solpoker = {
  "address": "Z2JAck8LPeRvUQp4Pn34FcYAHAGiBZg6FYtnF8Poker",
  "metadata": {
    "name": "solpoker",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Real-time on-chain Texas Hold'em with TEE-protected hole cards"
  },
  "instructions": [
    {
      "name": "abandonHand",
      "docs": [
        "Break-glass for a hand that can never settle: refunds every",
        "contribution and frees the table. Permissionless, and only an hour past",
        "the deadline."
      ],
      "discriminator": [
        224,
        127,
        130,
        186,
        47,
        125,
        109,
        75
      ],
      "accounts": [
        {
          "name": "table",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "table.table_id",
                "account": "table"
              }
            ]
          }
        },
        {
          "name": "hand",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ]
          }
        },
        {
          "name": "deck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ]
          }
        },
        {
          "name": "seat0",
          "writable": true
        },
        {
          "name": "seat1",
          "writable": true
        },
        {
          "name": "seat2",
          "writable": true
        },
        {
          "name": "seat3",
          "writable": true
        },
        {
          "name": "seat4",
          "writable": true
        },
        {
          "name": "seat5",
          "writable": true
        },
        {
          "name": "payer",
          "docs": [
            "Anyone at all. Recovery must not depend on a particular caller."
          ],
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "advanceStreet",
      "discriminator": [
        32,
        130,
        217,
        150,
        106,
        172,
        250,
        30
      ],
      "accounts": [
        {
          "name": "hand",
          "writable": true
        },
        {
          "name": "config"
        },
        {
          "name": "deck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "hand.table",
                "account": "hand"
              }
            ]
          }
        },
        {
          "name": "seat0",
          "writable": true
        },
        {
          "name": "seat1",
          "writable": true
        },
        {
          "name": "seat2",
          "writable": true
        },
        {
          "name": "seat3",
          "writable": true
        },
        {
          "name": "seat4",
          "writable": true
        },
        {
          "name": "seat5",
          "writable": true
        },
        {
          "name": "payer",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "buyChips",
      "discriminator": [
        220,
        21,
        249,
        76,
        148,
        60,
        83,
        192
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "vault",
          "docs": [
            "the guarantee; it has no data to check."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "chips",
          "type": "u64"
        }
      ]
    },
    {
      "name": "closeTable",
      "discriminator": [
        149,
        214,
        44,
        14,
        190,
        244,
        132,
        48
      ],
      "accounts": [
        {
          "name": "table",
          "docs": [
            "deserialized so a table from an older build is still deletable."
          ],
          "writable": true
        },
        {
          "name": "config",
          "writable": true
        },
        {
          "name": "payer",
          "docs": [
            "Whoever asked for this. Only matters as the fee payer: the rent goes to",
            "the creator regardless, so there is nothing to gain by sweeping someone",
            "else's empty table."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "hand",
          "docs": [
            "cannot make a table impossible to delete."
          ],
          "writable": true
        },
        {
          "name": "deck",
          "writable": true
        },
        {
          "name": "history",
          "writable": true
        },
        {
          "name": "creator",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "commitResults",
      "docs": [
        "Commit table state and record the last hand on the base layer."
      ],
      "discriminator": [
        149,
        119,
        7,
        235,
        101,
        77,
        163,
        72
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "hand",
          "writable": true
        },
        {
          "name": "table",
          "writable": true
        },
        {
          "name": "history",
          "docs": [
            "the hand's own table so a commit at one table cannot aim its action at",
            "another table's history."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  105,
                  115,
                  116,
                  111,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "hand.table",
                "account": "hand"
              }
            ]
          }
        },
        {
          "name": "programId",
          "address": "Z2JAck8LPeRvUQp4Pn34FcYAHAGiBZg6FYtnF8Poker"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "commitSalt",
      "discriminator": [
        179,
        59,
        159,
        178,
        197,
        154,
        191,
        162
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Whoever pays for and signs this transaction: either the player's wallet or",
            "their session key."
          ],
          "signer": true
        },
        {
          "name": "authority",
          "docs": [
            "and bound to `payer` by the session token when a session is used."
          ]
        },
        {
          "name": "hand",
          "writable": true
        },
        {
          "name": "seat",
          "writable": true
        },
        {
          "name": "sessionToken",
          "optional": true
        }
      ],
      "args": [
        {
          "name": "seatIndex",
          "type": "u8"
        },
        {
          "name": "commitment",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "createHistory",
      "discriminator": [
        17,
        80,
        83,
        78,
        168,
        45,
        161,
        35
      ],
      "accounts": [
        {
          "name": "table",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "table.table_id",
                "account": "table"
              }
            ]
          }
        },
        {
          "name": "history",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  105,
                  115,
                  116,
                  111,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "createHole",
      "discriminator": [
        56,
        28,
        125,
        206,
        228,
        194,
        203,
        173
      ],
      "accounts": [
        {
          "name": "table",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "table.table_id",
                "account": "table"
              }
            ]
          }
        },
        {
          "name": "hole",
          "writable": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "seatIndex",
          "type": "u8"
        }
      ]
    },
    {
      "name": "createSeat",
      "discriminator": [
        91,
        13,
        230,
        183,
        58,
        95,
        118,
        199
      ],
      "accounts": [
        {
          "name": "table",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "table.table_id",
                "account": "table"
              }
            ]
          }
        },
        {
          "name": "seat",
          "writable": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "seatIndex",
          "type": "u8"
        }
      ]
    },
    {
      "name": "createTable",
      "discriminator": [
        214,
        142,
        131,
        250,
        242,
        83,
        135,
        185
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "arg",
                "path": "tableId"
              }
            ]
          }
        },
        {
          "name": "table",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              },
              {
                "kind": "arg",
                "path": "tableId"
              }
            ]
          }
        },
        {
          "name": "hand",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ]
          }
        },
        {
          "name": "deck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ]
          }
        },
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "tableId",
          "type": "u64"
        },
        {
          "name": "smallBlind",
          "type": "u64"
        },
        {
          "name": "bigBlind",
          "type": "u64"
        },
        {
          "name": "minBuyIn",
          "type": "u64"
        },
        {
          "name": "maxBuyIn",
          "type": "u64"
        },
        {
          "name": "actionTimeoutSecs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "dealHoleCards",
      "discriminator": [
        114,
        39,
        65,
        192,
        193,
        88,
        193,
        175
      ],
      "accounts": [
        {
          "name": "hand",
          "writable": true
        },
        {
          "name": "deck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "hand.table",
                "account": "hand"
              }
            ]
          }
        },
        {
          "name": "hole0",
          "writable": true
        },
        {
          "name": "hole1",
          "writable": true
        },
        {
          "name": "hole2",
          "writable": true
        },
        {
          "name": "hole3",
          "writable": true
        },
        {
          "name": "hole4",
          "writable": true
        },
        {
          "name": "hole5",
          "writable": true
        },
        {
          "name": "payer",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "delegateCore",
      "discriminator": [
        218,
        65,
        18,
        5,
        187,
        239,
        80,
        31
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "bufferTable",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                8,
                52,
                13,
                30,
                5,
                121,
                169,
                82,
                42,
                10,
                3,
                117,
                126,
                75,
                86,
                103,
                147,
                5,
                224,
                249,
                111,
                238,
                4,
                54,
                172,
                89,
                36,
                217,
                12,
                133,
                160,
                143
              ]
            }
          }
        },
        {
          "name": "delegationRecordTable",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataTable",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "table",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              },
              {
                "kind": "arg",
                "path": "tableId"
              }
            ]
          }
        },
        {
          "name": "bufferHand",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "hand"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                8,
                52,
                13,
                30,
                5,
                121,
                169,
                82,
                42,
                10,
                3,
                117,
                126,
                75,
                86,
                103,
                147,
                5,
                224,
                249,
                111,
                238,
                4,
                54,
                172,
                89,
                36,
                217,
                12,
                133,
                160,
                143
              ]
            }
          }
        },
        {
          "name": "delegationRecordHand",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "hand"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataHand",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "hand"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "hand",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ]
          }
        },
        {
          "name": "bufferDeck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "deck"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                8,
                52,
                13,
                30,
                5,
                121,
                169,
                82,
                42,
                10,
                3,
                117,
                126,
                75,
                86,
                103,
                147,
                5,
                224,
                249,
                111,
                238,
                4,
                54,
                172,
                89,
                36,
                217,
                12,
                133,
                160,
                143
              ]
            }
          }
        },
        {
          "name": "delegationRecordDeck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "deck"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataDeck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "deck"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "deck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ]
          }
        },
        {
          "name": "validator",
          "docs": [
            "",
            "The module header has always said the validator is pinned; until now the",
            "only thing pinning it was a constant in the web client, and this",
            "instruction is permissionless. Anyone could delegate a table nobody had",
            "started yet to a rollup of their choosing — or to none in particular by",
            "passing `None` — and every card in the game depends on the accounts",
            "landing inside the enclave. Now the program will not delegate anywhere",
            "else."
          ],
          "address": "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo"
        },
        {
          "name": "ownerProgram",
          "address": "Z2JAck8LPeRvUQp4Pn34FcYAHAGiBZg6FYtnF8Poker"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "tableId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "delegateSeat",
      "discriminator": [
        53,
        85,
        50,
        81,
        161,
        68,
        71,
        212
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "table"
        },
        {
          "name": "bufferSeat",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "seat"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                8,
                52,
                13,
                30,
                5,
                121,
                169,
                82,
                42,
                10,
                3,
                117,
                126,
                75,
                86,
                103,
                147,
                5,
                224,
                249,
                111,
                238,
                4,
                54,
                172,
                89,
                36,
                217,
                12,
                133,
                160,
                143
              ]
            }
          }
        },
        {
          "name": "delegationRecordSeat",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "seat"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataSeat",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "seat"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "seat",
          "writable": true
        },
        {
          "name": "bufferHole",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "hole"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                8,
                52,
                13,
                30,
                5,
                121,
                169,
                82,
                42,
                10,
                3,
                117,
                126,
                75,
                86,
                103,
                147,
                5,
                224,
                249,
                111,
                238,
                4,
                54,
                172,
                89,
                36,
                217,
                12,
                133,
                160,
                143
              ]
            }
          }
        },
        {
          "name": "delegationRecordHole",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "hole"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataHole",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "hole"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "hole",
          "writable": true
        },
        {
          "name": "validator",
          "address": "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo"
        },
        {
          "name": "ownerProgram",
          "address": "Z2JAck8LPeRvUQp4Pn34FcYAHAGiBZg6FYtnF8Poker"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "seatIndex",
          "type": "u8"
        }
      ]
    },
    {
      "name": "forceTimeout",
      "docs": [
        "Permissionless turn clock. Anyone may call it once the deadline passes."
      ],
      "discriminator": [
        223,
        41,
        225,
        244,
        115,
        43,
        255,
        74
      ],
      "accounts": [
        {
          "name": "hand",
          "writable": true
        },
        {
          "name": "config"
        },
        {
          "name": "seat0",
          "writable": true
        },
        {
          "name": "seat1",
          "writable": true
        },
        {
          "name": "seat2",
          "writable": true
        },
        {
          "name": "seat3",
          "writable": true
        },
        {
          "name": "seat4",
          "writable": true
        },
        {
          "name": "seat5",
          "writable": true
        },
        {
          "name": "payer",
          "docs": [
            "Anyone at all. The clock must not depend on a particular caller."
          ],
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "holeCallback",
      "docs": [
        "The second oracle callback: randomness for the hole cards, which is",
        "stored on the private deck and never published."
      ],
      "discriminator": [
        248,
        137,
        156,
        191,
        245,
        152,
        128,
        235
      ],
      "accounts": [
        {
          "name": "vrfProgramIdentity",
          "docs": [
            "Scoped VRF identity PDA, bound to this program. Its presence as a signer proves",
            "the callback was issued by the VRF program for this program."
          ],
          "signer": true
        },
        {
          "name": "deck",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "randomness",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "initPlayer",
      "discriminator": [
        114,
        27,
        219,
        144,
        50,
        15,
        228,
        66
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "joinTable",
      "discriminator": [
        14,
        117,
        84,
        51,
        95,
        146,
        171,
        70
      ],
      "accounts": [
        {
          "name": "table",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "table.table_id",
                "account": "table"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "table.table_id",
                "account": "table"
              }
            ]
          }
        },
        {
          "name": "seat",
          "writable": true
        },
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "player"
          ]
        }
      ],
      "args": [
        {
          "name": "seatIndex",
          "type": "u8"
        },
        {
          "name": "buyIn",
          "type": "u64"
        }
      ]
    },
    {
      "name": "leaveTable",
      "discriminator": [
        163,
        153,
        94,
        194,
        19,
        106,
        113,
        32
      ],
      "accounts": [
        {
          "name": "table",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "table.table_id",
                "account": "table"
              }
            ]
          }
        },
        {
          "name": "seat",
          "writable": true
        },
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "player"
          ]
        }
      ],
      "args": [
        {
          "name": "seatIndex",
          "type": "u8"
        }
      ]
    },
    {
      "name": "playerAction",
      "discriminator": [
        37,
        85,
        25,
        135,
        200,
        116,
        96,
        101
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Whoever pays for and signs this transaction: either the player's wallet or",
            "their session key."
          ],
          "signer": true
        },
        {
          "name": "authority",
          "docs": [
            "and bound to `payer` by the session token when a session is used."
          ]
        },
        {
          "name": "hand",
          "writable": true
        },
        {
          "name": "config"
        },
        {
          "name": "seat0",
          "writable": true
        },
        {
          "name": "seat1",
          "writable": true
        },
        {
          "name": "seat2",
          "writable": true
        },
        {
          "name": "seat3",
          "writable": true
        },
        {
          "name": "seat4",
          "writable": true
        },
        {
          "name": "seat5",
          "writable": true
        },
        {
          "name": "sessionToken",
          "optional": true
        }
      ],
      "args": [
        {
          "name": "action",
          "type": {
            "defined": {
              "name": "playerMove"
            }
          }
        }
      ]
    },
    {
      "name": "processUndelegation",
      "discriminator": [
        196,
        28,
        41,
        206,
        48,
        37,
        51,
        167
      ],
      "accounts": [
        {
          "name": "baseAccount",
          "writable": true
        },
        {
          "name": "buffer",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  110,
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  101,
                  45,
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "baseAccount"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                181,
                183,
                0,
                225,
                242,
                87,
                58,
                192,
                204,
                6,
                34,
                1,
                52,
                74,
                207,
                151,
                184,
                53,
                6,
                235,
                140,
                229,
                25,
                152,
                204,
                98,
                126,
                24,
                147,
                128,
                167,
                62
              ]
            }
          }
        },
        {
          "name": "payer",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "accountSeeds",
          "type": {
            "vec": "bytes"
          }
        }
      ]
    },
    {
      "name": "recordHandResult",
      "docs": [
        "Base-layer target of the post-commit Magic Action."
      ],
      "discriminator": [
        67,
        15,
        133,
        115,
        225,
        196,
        240,
        152
      ],
      "accounts": [
        {
          "name": "history",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  105,
                  115,
                  116,
                  111,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "history.table",
                "account": "tableHistory"
              }
            ]
          }
        },
        {
          "name": "hand",
          "docs": [
            "raw. It cannot be `Account<'info, Hand>`: while the table is delegated",
            "this account is owned by the delegation program, so Anchor's owner check",
            "would reject it and the action would be stripped rather than refused."
          ]
        },
        {
          "name": "escrowAuth"
        },
        {
          "name": "escrow"
        }
      ],
      "args": [
        {
          "name": "handNumber",
          "type": "u64"
        },
        {
          "name": "resultHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "releaseHole",
      "docs": [
        "Give up your own hole-card read right so the next occupant of the seat",
        "can be named. Runs on the rollup, between hands."
      ],
      "discriminator": [
        182,
        115,
        147,
        242,
        64,
        92,
        237,
        65
      ],
      "accounts": [
        {
          "name": "hole",
          "writable": true
        },
        {
          "name": "seat",
          "writable": true
        },
        {
          "name": "permission",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  114,
                  109,
                  105,
                  115,
                  115,
                  105,
                  111,
                  110,
                  58
                ]
              },
              {
                "kind": "account",
                "path": "hole"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                136,
                161,
                10,
                196,
                33,
                152,
                1,
                214,
                246,
                106,
                29,
                60,
                6,
                152,
                192,
                102,
                169,
                175,
                212,
                217,
                180,
                252,
                231,
                71,
                151,
                141,
                209,
                5,
                168,
                212,
                103,
                82
              ]
            }
          }
        },
        {
          "name": "permissionProgram",
          "address": "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
        },
        {
          "name": "ephemeralVault",
          "writable": true,
          "address": "MagicVau1t999999999999999999999999999999999"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "payer",
          "docs": [
            "Whoever pays: the player's wallet or their session key."
          ],
          "signer": true
        },
        {
          "name": "authority",
          "docs": [
            "and bound to `payer` by the session token when a session is used."
          ]
        },
        {
          "name": "sessionToken",
          "optional": true
        }
      ],
      "args": [
        {
          "name": "seatIndex",
          "type": "u8"
        }
      ]
    },
    {
      "name": "requestShuffle",
      "discriminator": [
        130,
        20,
        53,
        22,
        23,
        102,
        225,
        135
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "hand",
          "writable": true
        },
        {
          "name": "deck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "hand.table",
                "account": "hand"
              }
            ]
          }
        },
        {
          "name": "oracleQueue",
          "docs": [
            "rollup. Accepting the whole family let a caller aim a request at a queue",
            "nobody operates — the base-layer queue, or the localnet test queue — and",
            "the fulfilment would then never arrive. Before `reset_shuffle` existed",
            "that was a one-transaction, permanent brick on any table; it is now a",
            "recoverable stall, and there is still no reason to allow it."
          ],
          "writable": true,
          "address": "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc"
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "resetShuffle",
      "docs": [
        "Permissionless escape hatch for a shuffle request the oracle never",
        "answered. Time-gated, like `force_timeout`."
      ],
      "discriminator": [
        225,
        92,
        88,
        96,
        208,
        66,
        7,
        119
      ],
      "accounts": [
        {
          "name": "table",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "table.table_id",
                "account": "table"
              }
            ]
          }
        },
        {
          "name": "hand",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ]
          }
        },
        {
          "name": "deck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ]
          }
        },
        {
          "name": "payer",
          "docs": [
            "Anyone at all. Recovery must not depend on a particular caller, for the",
            "same reason `force_timeout` does not."
          ],
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "revealSalt",
      "discriminator": [
        11,
        109,
        254,
        128,
        82,
        47,
        99,
        12
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Whoever pays for and signs this transaction: either the player's wallet or",
            "their session key."
          ],
          "signer": true
        },
        {
          "name": "authority",
          "docs": [
            "and bound to `payer` by the session token when a session is used."
          ]
        },
        {
          "name": "hand",
          "writable": true
        },
        {
          "name": "seat",
          "writable": true
        },
        {
          "name": "sessionToken",
          "optional": true
        }
      ],
      "args": [
        {
          "name": "seatIndex",
          "type": "u8"
        },
        {
          "name": "salt",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "secureDeck",
      "docs": [
        "Lock the deck so no wallet can read it. Runs on the rollup."
      ],
      "discriminator": [
        238,
        52,
        49,
        121,
        144,
        2,
        34,
        209
      ],
      "accounts": [
        {
          "name": "deck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "deck.table",
                "account": "deck"
              }
            ]
          }
        },
        {
          "name": "permission",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  114,
                  109,
                  105,
                  115,
                  115,
                  105,
                  111,
                  110,
                  58
                ]
              },
              {
                "kind": "account",
                "path": "deck"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                136,
                161,
                10,
                196,
                33,
                152,
                1,
                214,
                246,
                106,
                29,
                60,
                6,
                152,
                192,
                102,
                169,
                175,
                212,
                217,
                180,
                252,
                231,
                71,
                151,
                141,
                209,
                5,
                168,
                212,
                103,
                82
              ]
            }
          }
        },
        {
          "name": "permissionProgram",
          "address": "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
        },
        {
          "name": "ephemeralVault",
          "writable": true,
          "address": "MagicVau1t999999999999999999999999999999999"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "payer",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "secureHole",
      "docs": [
        "Restrict a seat's hole cards to its occupant. Runs on the rollup."
      ],
      "discriminator": [
        202,
        207,
        120,
        53,
        238,
        194,
        131,
        64
      ],
      "accounts": [
        {
          "name": "hole",
          "writable": true
        },
        {
          "name": "seat",
          "writable": true
        },
        {
          "name": "permission",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  114,
                  109,
                  105,
                  115,
                  115,
                  105,
                  111,
                  110,
                  58
                ]
              },
              {
                "kind": "account",
                "path": "hole"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                136,
                161,
                10,
                196,
                33,
                152,
                1,
                214,
                246,
                106,
                29,
                60,
                6,
                152,
                192,
                102,
                169,
                175,
                212,
                217,
                180,
                252,
                231,
                71,
                151,
                141,
                209,
                5,
                168,
                212,
                103,
                82
              ]
            }
          }
        },
        {
          "name": "permissionProgram",
          "address": "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
        },
        {
          "name": "ephemeralVault",
          "writable": true,
          "address": "MagicVau1t999999999999999999999999999999999"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "payer",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "seatIndex",
          "type": "u8"
        }
      ]
    },
    {
      "name": "sellChips",
      "discriminator": [
        147,
        50,
        20,
        82,
        168,
        167,
        109,
        110
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "chips",
          "type": "u64"
        }
      ]
    },
    {
      "name": "settleHand",
      "discriminator": [
        226,
        143,
        58,
        196,
        148,
        75,
        164,
        43
      ],
      "accounts": [
        {
          "name": "table",
          "writable": true
        },
        {
          "name": "config"
        },
        {
          "name": "hand",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ]
          }
        },
        {
          "name": "deck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ]
          }
        },
        {
          "name": "seat0",
          "writable": true
        },
        {
          "name": "seat1",
          "writable": true
        },
        {
          "name": "seat2",
          "writable": true
        },
        {
          "name": "seat3",
          "writable": true
        },
        {
          "name": "seat4",
          "writable": true
        },
        {
          "name": "seat5",
          "writable": true
        },
        {
          "name": "payer",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "shuffleCallback",
      "discriminator": [
        194,
        63,
        246,
        15,
        138,
        108,
        43,
        64
      ],
      "accounts": [
        {
          "name": "vrfProgramIdentity",
          "docs": [
            "Scoped VRF identity PDA, bound to this program. Its presence as a signer proves",
            "the callback was issued by the VRF program for this program."
          ],
          "signer": true
        },
        {
          "name": "deck",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "randomness",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "startHand",
      "discriminator": [
        50,
        173,
        164,
        52,
        65,
        42,
        197,
        135
      ],
      "accounts": [
        {
          "name": "table",
          "writable": true
        },
        {
          "name": "config"
        },
        {
          "name": "hand",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ]
          }
        },
        {
          "name": "deck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ]
          }
        },
        {
          "name": "seat0",
          "writable": true
        },
        {
          "name": "seat1",
          "writable": true
        },
        {
          "name": "seat2",
          "writable": true
        },
        {
          "name": "seat3",
          "writable": true
        },
        {
          "name": "seat4",
          "writable": true
        },
        {
          "name": "seat5",
          "writable": true
        },
        {
          "name": "payer",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "sweepRake",
      "docs": [
        "Move a table's accrued rake into the treasury balance. Permissionless;",
        "the destination is fixed."
      ],
      "discriminator": [
        8,
        64,
        18,
        95,
        96,
        177,
        71,
        195
      ],
      "accounts": [
        {
          "name": "table",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "table.table_id",
                "account": "table"
              }
            ]
          }
        },
        {
          "name": "treasury",
          "docs": [
            "The house's own balance, and the only account this can credit."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "const",
                "value": [
                  215,
                  141,
                  165,
                  153,
                  179,
                  14,
                  56,
                  150,
                  219,
                  250,
                  15,
                  96,
                  148,
                  190,
                  166,
                  176,
                  234,
                  171,
                  213,
                  171,
                  49,
                  62,
                  93,
                  120,
                  191,
                  61,
                  235,
                  109,
                  17,
                  196,
                  200,
                  120
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "docs": [
            "Anyone at all: the destination is fixed, so there is nothing to gain."
          ],
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "undelegateCore",
      "discriminator": [
        5,
        232,
        220,
        247,
        236,
        36,
        148,
        43
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "table",
          "writable": true
        },
        {
          "name": "hand",
          "writable": true
        },
        {
          "name": "deck",
          "writable": true
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "undelegateSeat",
      "discriminator": [
        44,
        75,
        207,
        37,
        253,
        211,
        217,
        104
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "table",
          "docs": [
            "table the seat and hole account both name. Present so undelegation can",
            "refuse while a hand is live; an already-undelegated table reads as idle,",
            "which is what keeps a half-paused table recoverable."
          ]
        },
        {
          "name": "seat",
          "writable": true
        },
        {
          "name": "hole",
          "writable": true
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "vacateSeat",
      "discriminator": [
        64,
        212,
        25,
        14,
        67,
        107,
        59,
        17
      ],
      "accounts": [
        {
          "name": "table",
          "docs": [
            "so seats on tables from older builds can still be cleared."
          ],
          "writable": true
        },
        {
          "name": "config"
        },
        {
          "name": "hand",
          "docs": [
            "The staleness clock for the non-creator path."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ]
          }
        },
        {
          "name": "seat",
          "writable": true
        },
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player.authority",
                "account": "player"
              }
            ]
          }
        },
        {
          "name": "payer",
          "docs": [
            "The creator at any time, or anyone once the table is stale."
          ],
          "signer": true
        }
      ],
      "args": [
        {
          "name": "seatIndex",
          "type": "u8"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "deck",
      "discriminator": [
        192,
        215,
        78,
        133,
        216,
        161,
        59,
        154
      ]
    },
    {
      "name": "hand",
      "discriminator": [
        51,
        56,
        101,
        152,
        196,
        199,
        104,
        242
      ]
    },
    {
      "name": "holeCards",
      "discriminator": [
        221,
        130,
        89,
        194,
        118,
        188,
        165,
        42
      ]
    },
    {
      "name": "player",
      "discriminator": [
        205,
        222,
        112,
        7,
        165,
        155,
        206,
        218
      ]
    },
    {
      "name": "seat",
      "discriminator": [
        90,
        228,
        22,
        90,
        162,
        86,
        173,
        26
      ]
    },
    {
      "name": "table",
      "discriminator": [
        34,
        100,
        138,
        97,
        236,
        129,
        230,
        112
      ]
    },
    {
      "name": "tableConfig",
      "discriminator": [
        170,
        18,
        158,
        124,
        72,
        3,
        198,
        193
      ]
    },
    {
      "name": "tableHistory",
      "discriminator": [
        66,
        54,
        144,
        221,
        19,
        98,
        57,
        30
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "faucetOnCooldown",
      "msg": "Faucet is still on cooldown"
    },
    {
      "code": 6001,
      "name": "insufficientChips",
      "msg": "Not enough chips"
    },
    {
      "code": 6002,
      "name": "buyInOutOfRange",
      "msg": "Buy-in is outside the table's limits"
    },
    {
      "code": 6003,
      "name": "seatIndexOutOfRange",
      "msg": "Seat index is out of range for this table"
    },
    {
      "code": 6004,
      "name": "seatOccupied",
      "msg": "That seat is already taken"
    },
    {
      "code": 6005,
      "name": "seatEmpty",
      "msg": "That seat is empty"
    },
    {
      "code": 6006,
      "name": "notSeated",
      "msg": "You are not seated at this table"
    },
    {
      "code": 6007,
      "name": "alreadySeated",
      "msg": "You are already seated at this table"
    },
    {
      "code": 6008,
      "name": "handInProgress",
      "msg": "Cannot do that while a hand is in progress"
    },
    {
      "code": 6009,
      "name": "noHandInProgress",
      "msg": "No hand is in progress"
    },
    {
      "code": 6010,
      "name": "notEnoughPlayers",
      "msg": "Need at least two funded players to start a hand"
    },
    {
      "code": 6011,
      "name": "outOfTurn",
      "msg": "It is not your turn to act"
    },
    {
      "code": 6012,
      "name": "illegalAction",
      "msg": "That action is not legal right now"
    },
    {
      "code": 6013,
      "name": "cannotCheck",
      "msg": "Cannot check while facing a bet"
    },
    {
      "code": 6014,
      "name": "nothingToCall",
      "msg": "Nothing to call"
    },
    {
      "code": 6015,
      "name": "cannotRaise",
      "msg": "Raising is not allowed here"
    },
    {
      "code": 6016,
      "name": "raiseTooSmall",
      "msg": "Raise does not exceed the current bet"
    },
    {
      "code": 6017,
      "name": "belowMinRaise",
      "msg": "Raise is below the minimum raise and is not an all-in"
    },
    {
      "code": 6018,
      "name": "streetNotComplete",
      "msg": "Betting is still open on this street"
    },
    {
      "code": 6019,
      "name": "streetComplete",
      "msg": "The betting street is already complete"
    },
    {
      "code": 6020,
      "name": "deckExhausted",
      "msg": "The deck has run out of cards"
    },
    {
      "code": 6021,
      "name": "deadlineNotReached",
      "msg": "The action clock has not expired yet"
    },
    {
      "code": 6022,
      "name": "unclaimedChips",
      "msg": "Settlement left unclaimed chips, which should be impossible"
    },
    {
      "code": 6023,
      "name": "seatTableMismatch",
      "msg": "Seat account does not belong to this table"
    },
    {
      "code": 6024,
      "name": "seatOrderMismatch",
      "msg": "Seat accounts were supplied in the wrong order"
    },
    {
      "code": 6025,
      "name": "alreadyDelegated",
      "msg": "This table's accounts are already delegated"
    },
    {
      "code": 6026,
      "name": "notDelegated",
      "msg": "This table's accounts are not delegated"
    },
    {
      "code": 6027,
      "name": "handNumberMismatch",
      "msg": "Hand number does not match the table"
    },
    {
      "code": 6028,
      "name": "saltNotCommitted",
      "msg": "No salt commitment for this seat"
    },
    {
      "code": 6029,
      "name": "saltMismatch",
      "msg": "Revealed salt does not match the commitment"
    },
    {
      "code": 6030,
      "name": "shuffleAlreadyRequested",
      "msg": "Shuffle randomness was already requested"
    },
    {
      "code": 6031,
      "name": "noShuffleRequested",
      "msg": "No shuffle request is outstanding"
    },
    {
      "code": 6032,
      "name": "notEnoughSalts",
      "msg": "Need at least two revealed salts"
    },
    {
      "code": 6033,
      "name": "shuffleNotReady",
      "msg": "Shuffle seed is not ready yet"
    },
    {
      "code": 6034,
      "name": "notTableCreator",
      "msg": "Only the player who created this table can do that"
    },
    {
      "code": 6035,
      "name": "tableNotEmpty",
      "msg": "Every seat must be empty before the table can be closed"
    },
    {
      "code": 6036,
      "name": "tableNotAbandoned",
      "msg": "Only the creator can delete a table until it has sat empty for an hour"
    },
    {
      "code": 6037,
      "name": "insufficientVault",
      "msg": "The vault cannot cover that sale"
    },
    {
      "code": 6038,
      "name": "configTableMismatch",
      "msg": "That config account belongs to a different table"
    },
    {
      "code": 6039,
      "name": "cardsNotSecured",
      "msg": "Cards are not locked down yet; the table must be secured before a hand can start"
    },
    {
      "code": 6040,
      "name": "saltCommitClosed",
      "msg": "Salts are already being revealed, so commitments are closed"
    },
    {
      "code": 6041,
      "name": "timeoutOutOfRange",
      "msg": "A table's turn clock must be between 10 and 300 seconds"
    },
    {
      "code": 6042,
      "name": "shuffleNotStale",
      "msg": "The outstanding shuffle request is not stale enough to clear yet"
    },
    {
      "code": 6043,
      "name": "tableMismatch",
      "msg": "That account belongs to a different table"
    },
    {
      "code": 6044,
      "name": "validatorNotPinned",
      "msg": "This rollup is not the pinned TEE validator"
    }
  ],
  "types": [
    {
      "name": "deck",
      "docs": [
        "The shuffled deck. **Delegated to the ER; made TEE-private in Phase 4.**",
        "",
        "Until Phase 4 this account is world-readable, which is exactly why Phase 3",
        "plays face-up: the privacy work is what makes hidden cards possible, and",
        "pretending otherwise before then would be dishonest."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "table",
            "type": "pubkey"
          },
          {
            "name": "cards",
            "type": {
              "array": [
                "u8",
                52
              ]
            }
          },
          {
            "name": "nextIndex",
            "type": "u8"
          },
          {
            "name": "vrfRandomness",
            "docs": [
              "Raw VRF output, delivered here rather than to the public hand.",
              "",
              "The deck account is the one place nobody can read, and the seed must be",
              "secret while the hand runs: salts are public once revealed, so seed and",
              "VRF output on a readable account would let anyone recompute the entire",
              "deck mid-hand. Both are copied to the hand at settlement, which is when",
              "the verifier needs them and the moment they stop being dangerous."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "shuffleSeed",
            "docs": [
              "`vrf_randomness XOR salt_xor`, fixed when the hand starts.",
              "",
              "This seed governs the **board only**. It is published at settlement, and",
              "everything it determines becomes public with it."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "holeRandomness",
            "docs": [
              "A second, independent VRF draw that decides who gets which hole cards,",
              "and which is **never published**.",
              "",
              "One draw cannot do both jobs. Proving the board was fair means",
              "publishing the value it came from, and any hole cards derived from that",
              "same value are published along with it — XOR is reversible and hashing",
              "the two apart does not help, because a verifier who cannot see the input",
              "cannot check the output either. So the board gets a seed that is",
              "published and the hole cards get one that never leaves this account.",
              "",
              "That split is exactly the trust model this project already states:",
              "provably fair shuffle, TEE-protected hole cards. The board is checkable",
              "by anyone with no trust required; the hole cards rest on the enclave,",
              "as they always did. What changes is that a folded hand now stays folded."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "board",
            "docs": [
              "The five community cards, dealt at `start_hand` and revealed a street at",
              "a time. They live here, on the private deck, rather than being dealt off",
              "the top as each street opens: the board has to come from the published",
              "seed while the hole cards come from the secret one, so the two are drawn",
              "from different places and the board is settled before any hole card is."
            ],
            "type": {
              "array": [
                "u8",
                5
              ]
            }
          },
          {
            "name": "shuffleState",
            "docs": [
              "The private half of the shuffle state machine. The public half on the",
              "hand only ever says \"requested\", because fulfillment arriving is itself",
              "information about when the deck became computable inside the enclave.",
              "",
              "Two draws are outstanding at once, so `SHUFFLE_FULFILLED` means both",
              "have landed. [`Deck::fulfilled_mask`] tracks them separately until then."
            ],
            "type": "u8"
          },
          {
            "name": "fulfilledMask",
            "docs": [
              "Which of the two randomness draws have arrived: bit 0 the board, bit 1",
              "the hole cards. They are requested together and answered independently,",
              "in either order."
            ],
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "secured",
            "docs": [
              "Has `secure_deck` locked this deck to nobody yet?",
              "",
              "`start_hand` refuses without it. The VRF output lands here and the salts",
              "are public, so a deck that is still world-readable when a hand starts is",
              "the whole deck in the open: anyone can XOR the two together and deal the",
              "board out ahead of the table. Nothing else on chain enforced the order of",
              "these calls, so this is the bit that does.",
              "",
              "Not cleared by [`Deck::zeroize`]: the permission is created once and",
              "outlives the hand, so re-securing every hand would be work with no effect."
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "hand",
      "docs": [
        "The hand in progress. **Delegated to the ER.**",
        "",
        "One PDA per table, overwritten each hand rather than created per hand, so no",
        "new account has to be delegated between hands."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "table",
            "type": "pubkey"
          },
          {
            "name": "handNumber",
            "type": "u64"
          },
          {
            "name": "street",
            "docs": [
              "Encodes [`poker_engine::betting::Street`]."
            ],
            "type": "u8"
          },
          {
            "name": "board",
            "docs": [
              "Community cards; `0xFF` for undealt slots."
            ],
            "type": {
              "array": [
                "u8",
                5
              ]
            }
          },
          {
            "name": "currentBet",
            "docs": [
              "Highest street commitment anyone must match."
            ],
            "type": "u64"
          },
          {
            "name": "minRaise",
            "docs": [
              "Minimum raise increment over `current_bet`."
            ],
            "type": "u64"
          },
          {
            "name": "toAct",
            "docs": [
              "Seat to act, or [`NO_SEAT`] when the street is complete."
            ],
            "type": "u8"
          },
          {
            "name": "button",
            "type": "u8"
          },
          {
            "name": "lastAggressor",
            "type": "u8"
          },
          {
            "name": "dealtIn",
            "docs": [
              "Bitmask of seats dealt into this hand. Lets instructions that only touch",
              "hole cards avoid loading all six seat accounts, which keeps them inside",
              "the BPF stack frame."
            ],
            "type": "u8"
          },
          {
            "name": "deadline",
            "docs": [
              "Unix time after which anyone may force a timeout on `to_act`."
            ],
            "type": "i64"
          },
          {
            "name": "shuffleSeed",
            "docs": [
              "Seed the deck was shuffled from, published at hand end so the shuffle can",
              "be verified. Phase 5 fills this from VRF combined with player salts."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "revealed",
            "docs": [
              "Hole cards of players who reached showdown, copied here at settlement so",
              "they become public. Everyone else is mucked and stays `0xFF`."
            ],
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    2
                  ]
                },
                6
              ]
            }
          },
          {
            "name": "revealedMask",
            "docs": [
              "Bitmask of seats whose cards were revealed rather than mucked."
            ],
            "type": "u8"
          },
          {
            "name": "saltXor",
            "docs": [
              "XOR of every revealed salt, accumulated as players reveal."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "saltMask",
            "docs": [
              "Bitmask of seats that have revealed a salt this hand."
            ],
            "type": "u8"
          },
          {
            "name": "vrfRandomness",
            "docs": [
              "Raw VRF output, kept alongside the salts so the combination is checkable."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "shuffleState",
            "docs": [
              "0 idle, 1 requested, 2 fulfilled."
            ],
            "type": "u8"
          },
          {
            "name": "resultHash",
            "docs": [
              "Digest of the finished hand: number, seed, board and payouts. Committed to",
              "the base layer so a hand can be pinned without publishing every detail."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "holeCards",
      "docs": [
        "Hole cards for one seat. **Delegated to the ER; TEE-private from Phase 4.**",
        "",
        "Phase 3 keeps these public so the real-time loop can be built and verified",
        "first. Phase 4 attaches an `EphemeralPermission` whose only member is the",
        "seat's occupant."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "table",
            "type": "pubkey"
          },
          {
            "name": "seatIndex",
            "type": "u8"
          },
          {
            "name": "handNumber",
            "type": "u64"
          },
          {
            "name": "cards",
            "type": {
              "array": [
                "u8",
                2
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "player",
      "docs": [
        "A player's chip balance. **Never delegated.**",
        "",
        "This is the only account that holds chips at rest, and it stays on the base",
        "layer so a player's balance is always settled on Solana rather than living",
        "inside a rollup.",
        "",
        "Chips are **not** play money. They are bought with SOL and sold back for SOL",
        "at a fixed rate, one to one against the program vault, so a chip is a claim",
        "on real lamports and every instruction that touches one is handling",
        "somebody's money. An earlier version of this comment said the opposite,",
        "which was true when a faucet minted them and has been wrong since it was",
        "removed. `last_faucet_ts` survives only so the layout does not move."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "chips",
            "docs": [
              "Chips not currently committed to a seat."
            ],
            "type": "u64"
          },
          {
            "name": "lastFaucetTs",
            "type": "i64"
          },
          {
            "name": "handsPlayed",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "playerMove",
      "docs": [
        "A betting action, in the shape the client sends it."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "fold"
          },
          {
            "name": "check"
          },
          {
            "name": "call"
          },
          {
            "name": "raiseTo",
            "fields": [
              "u64"
            ]
          },
          {
            "name": "allIn"
          }
        ]
      }
    },
    {
      "name": "seat",
      "docs": [
        "One seat's chips and per-hand state. **Delegated to the ER.**",
        "",
        "One PDA per seat index, created with the table and reused for its lifetime, so",
        "a seat's address is stable and never needs re-delegating as players come and go."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "table",
            "type": "pubkey"
          },
          {
            "name": "seatIndex",
            "type": "u8"
          },
          {
            "name": "occupant",
            "docs": [
              "Current occupant, or `Pubkey::default()` when empty."
            ],
            "type": "pubkey"
          },
          {
            "name": "stack",
            "docs": [
              "Chips in front of this seat. Moves to and from [`Player::chips`]."
            ],
            "type": "u64"
          },
          {
            "name": "committedStreet",
            "docs": [
              "Chips pushed forward on the current street."
            ],
            "type": "u64"
          },
          {
            "name": "committedTotal",
            "docs": [
              "Chips pushed forward across the whole hand."
            ],
            "type": "u64"
          },
          {
            "name": "folded",
            "type": "bool"
          },
          {
            "name": "allIn",
            "type": "bool"
          },
          {
            "name": "needsAction",
            "docs": [
              "Still owes an action this street."
            ],
            "type": "bool"
          },
          {
            "name": "mayRaise",
            "docs": [
              "May raise if it acts. Cleared by an under-raise all-in, per poker rules."
            ],
            "type": "bool"
          },
          {
            "name": "inHand",
            "docs": [
              "Dealt in for the current hand. False for someone who joined mid-hand."
            ],
            "type": "bool"
          },
          {
            "name": "lastActionSlot",
            "type": "u64"
          },
          {
            "name": "saltCommit",
            "docs": [
              "SHA-256 of this seat's shuffle salt, submitted before the deal."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "salt",
            "docs": [
              "The revealed salt. Published so anyone can recompute the shuffle."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "saltState",
            "docs": [
              "0 none, 1 committed, 2 revealed."
            ],
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "cardsSecured",
            "docs": [
              "Has `secure_hole` ever pointed this seat's permission at its occupant?",
              "",
              "Advisory only. `start_hand` deliberately does **not** gate on it, and the",
              "long comment there explains why: a hole-card permission can only be",
              "updated by the member it already names, so a seat secured while empty",
              "names nobody and can never be re-pointed once someone sits down. Refusing",
              "to deal on that basis wedges the table permanently.",
              "",
              "Cleared when the occupant changes, so a client can see that the",
              "permission is stale and try to fix it while it still can."
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "sessionTokenV2",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "targetProgram",
            "type": "pubkey"
          },
          {
            "name": "sessionSigner",
            "type": "pubkey"
          },
          {
            "name": "feePayer",
            "type": "pubkey"
          },
          {
            "name": "validUntil",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "table",
      "docs": [
        "Mutable table state. **Delegated to the ER.**"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tableId",
            "type": "u64"
          },
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "seats",
            "docs": [
              "Occupant of each seat, or `Pubkey::default()` when empty."
            ],
            "type": {
              "array": [
                "pubkey",
                6
              ]
            }
          },
          {
            "name": "button",
            "type": "u8"
          },
          {
            "name": "handNumber",
            "type": "u64"
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "tableState"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "emptySince",
            "docs": [
              "When the last player left, or 0 while anyone is still seated.",
              "",
              "Appended after `bump` on purpose: every field before it keeps the",
              "offset it has always had, so a client reading a table written by an",
              "older build gets the same answers and simply finds nothing here.",
              "",
              "An abandoned table would otherwise sit in the lobby forever, because",
              "only its creator can delete it and creators lose keys. This is the",
              "clock that lets anyone sweep one once it has been empty long enough."
            ],
            "type": "i64"
          },
          {
            "name": "rakeAccrued",
            "docs": [
              "Rake taken at this table and not yet moved to the treasury.",
              "",
              "It accumulates here rather than going straight to the house because",
              "settlement runs on the rollup and the treasury balance is a base-layer",
              "[`Player`] account, which the rollup cannot write. So the chips wait on",
              "the table — which is delegated, and therefore writable at settlement —",
              "and `sweep_rake` moves them once the table is back on Solana.",
              "",
              "Chips are conserved the whole way: they leave the seats at settlement,",
              "sit here, and land in the treasury's balance. None are created, and the",
              "vault backs them exactly as it backed them when a player bought them."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "tableConfig",
      "docs": [
        "Immutable table parameters. **Never delegated.**"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tableId",
            "type": "u64"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "smallBlind",
            "type": "u64"
          },
          {
            "name": "bigBlind",
            "type": "u64"
          },
          {
            "name": "minBuyIn",
            "type": "u64"
          },
          {
            "name": "maxBuyIn",
            "type": "u64"
          },
          {
            "name": "maxSeats",
            "type": "u8"
          },
          {
            "name": "actionTimeoutSecs",
            "docs": [
              "Seconds a player has to act before anyone may time them out. Per table so",
              "a fast game and a slow game can coexist."
            ],
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "tableHistory",
      "docs": [
        "Base-layer record of hands played at a table. **Never delegated.**",
        "",
        "Written by a post-commit Magic Action at settlement, so the rollup can leave a",
        "permanent trace on Solana without anyone sending a separate transaction."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "table",
            "type": "pubkey"
          },
          {
            "name": "handsRecorded",
            "type": "u64"
          },
          {
            "name": "lastHandNumber",
            "type": "u64"
          },
          {
            "name": "lastResultHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "tableState",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "waiting"
          },
          {
            "name": "handInProgress"
          }
        ]
      }
    }
  ]
};
