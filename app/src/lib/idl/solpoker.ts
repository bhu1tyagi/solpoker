/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/solpoker.json`.
 */
export type Solpoker = {
  "address": "CJT1DDJe5cFsSVcwTAWr3wEo7QEqNjrXwmWkw1pdxmJd",
  "metadata": {
    "name": "solpoker",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Real-time on-chain Texas Hold'em with TEE-protected hole cards"
  },
  "instructions": [
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
      "name": "claimFaucet",
      "discriminator": [
        80,
        7,
        251,
        108,
        55,
        145,
        135,
        68
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
          "signer": true,
          "relations": [
            "player"
          ]
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
          "name": "table",
          "writable": true
        },
        {
          "name": "hand",
          "writable": true
        },
        {
          "name": "history"
        },
        {
          "name": "programId",
          "address": "CJT1DDJe5cFsSVcwTAWr3wEo7QEqNjrXwmWkw1pdxmJd"
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
                167,
                232,
                213,
                20,
                103,
                170,
                243,
                200,
                157,
                224,
                105,
                185,
                238,
                119,
                246,
                215,
                192,
                148,
                127,
                149,
                209,
                130,
                19,
                232,
                128,
                185,
                203,
                34,
                24,
                15,
                39,
                102
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
                167,
                232,
                213,
                20,
                103,
                170,
                243,
                200,
                157,
                224,
                105,
                185,
                238,
                119,
                246,
                215,
                192,
                148,
                127,
                149,
                209,
                130,
                19,
                232,
                128,
                185,
                203,
                34,
                24,
                15,
                39,
                102
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
                167,
                232,
                213,
                20,
                103,
                170,
                243,
                200,
                157,
                224,
                105,
                185,
                238,
                119,
                246,
                215,
                192,
                148,
                127,
                149,
                209,
                130,
                19,
                232,
                128,
                185,
                203,
                34,
                24,
                15,
                39,
                102
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
          "optional": true
        },
        {
          "name": "ownerProgram",
          "address": "CJT1DDJe5cFsSVcwTAWr3wEo7QEqNjrXwmWkw1pdxmJd"
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
                167,
                232,
                213,
                20,
                103,
                170,
                243,
                200,
                157,
                224,
                105,
                185,
                238,
                119,
                246,
                215,
                192,
                148,
                127,
                149,
                209,
                130,
                19,
                232,
                128,
                185,
                203,
                34,
                24,
                15,
                39,
                102
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
                167,
                232,
                213,
                20,
                103,
                170,
                243,
                200,
                157,
                224,
                105,
                185,
                238,
                119,
                246,
                215,
                192,
                148,
                127,
                149,
                209,
                130,
                19,
                232,
                128,
                185,
                203,
                34,
                24,
                15,
                39,
                102
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
          "optional": true
        },
        {
          "name": "ownerProgram",
          "address": "CJT1DDJe5cFsSVcwTAWr3wEo7QEqNjrXwmWkw1pdxmJd"
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
          "name": "oracleQueue",
          "writable": true
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
          "name": "seat"
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
          "name": "hand",
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
            "name": "bump",
            "type": "u8"
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
        "A player's chip balance and faucet state. **Never delegated.**",
        "",
        "This is the only account that holds chips at rest, and it stays on the base",
        "layer so a player's balance is always settled on Solana rather than living",
        "inside a rollup. Chips are play money: they enter only through the faucet and",
        "can never leave for anything of value."
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
