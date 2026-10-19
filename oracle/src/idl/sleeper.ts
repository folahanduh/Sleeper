/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/sleeper.json`.
 */
export type Sleeper = {
  "address": "5cP2rHGPuEWRHQ74mbzdFhNKYLfpH6rSaXtKHekoRNrL",
  "metadata": {
    "name": "sleeper",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Sleeper: songs as coins, settled on real-world traction"
  },
  "instructions": [
    {
      "name": "acceptAdmin",
      "discriminator": [
        112,
        42,
        45,
        90,
        116,
        181,
        13,
        170
      ],
      "accounts": [
        {
          "name": "newAdmin",
          "signer": true
        },
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
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "applyPayout",
      "discriminator": [
        225,
        11,
        224,
        196,
        151,
        147,
        71,
        19
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
              }
            ]
          }
        },
        {
          "name": "song",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  111,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "song.songId",
                "account": "song"
              }
            ]
          }
        },
        {
          "name": "season",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "song.seasonId",
                "account": "song"
              }
            ]
          }
        },
        {
          "name": "nextSeason",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "buy",
      "discriminator": [
        102,
        6,
        61,
        18,
        1,
        218,
        235,
        234
      ],
      "accounts": [
        {
          "name": "trader",
          "writable": true,
          "signer": true
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
              }
            ]
          }
        },
        {
          "name": "song",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  111,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "song.songId",
                "account": "song"
              }
            ]
          }
        },
        {
          "name": "season",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "song.seasonId",
                "account": "song"
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "mint",
          "relations": [
            "song"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "song"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "traderAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "trader"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "maxSol",
          "type": "u64"
        },
        {
          "name": "minTokens",
          "type": "u64"
        }
      ]
    },
    {
      "name": "claimCreatorFees",
      "discriminator": [
        0,
        23,
        125,
        234,
        156,
        118,
        134,
        89
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true,
          "relations": [
            "song"
          ]
        },
        {
          "name": "song",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  111,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "song.songId",
                "account": "song"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "finalizeSeason",
      "discriminator": [
        183,
        221,
        183,
        7,
        73,
        215,
        158,
        50
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
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
              }
            ]
          }
        },
        {
          "name": "season",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "config.currentSeason",
                "account": "config"
              }
            ]
          }
        },
        {
          "name": "nextSeason",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
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
              }
            ]
          }
        },
        {
          "name": "season",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "const",
                "value": [
                  0,
                  0,
                  0,
                  0
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "configParams"
            }
          }
        }
      ]
    },
    {
      "name": "launchSong",
      "discriminator": [
        235,
        97,
        48,
        60,
        192,
        57,
        2,
        113
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "oracle",
          "signer": true
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
              }
            ]
          }
        },
        {
          "name": "season",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "config.currentSeason",
                "account": "config"
              }
            ]
          }
        },
        {
          "name": "song",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  111,
                  110,
                  103
                ]
              },
              {
                "kind": "arg",
                "path": "args.songId"
              }
            ]
          }
        },
        {
          "name": "mint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "song"
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
                "kind": "account",
                "path": "song"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "launchArgs"
            }
          }
        }
      ]
    },
    {
      "name": "proposeAdmin",
      "discriminator": [
        121,
        214,
        199,
        212,
        87,
        39,
        117,
        234
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
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
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newAdmin",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "scoreSong",
      "discriminator": [
        35,
        95,
        18,
        16,
        148,
        65,
        179,
        219
      ],
      "accounts": [
        {
          "name": "scorer",
          "signer": true
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
              }
            ]
          }
        },
        {
          "name": "song",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  111,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "song.songId",
                "account": "song"
              }
            ]
          }
        },
        {
          "name": "season",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "song.seasonId",
                "account": "song"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "finalTraction",
          "type": "u64"
        },
        {
          "name": "snapshotHash",
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
      "name": "sell",
      "discriminator": [
        51,
        230,
        133,
        164,
        1,
        127,
        131,
        173
      ],
      "accounts": [
        {
          "name": "trader",
          "writable": true,
          "signer": true
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
              }
            ]
          }
        },
        {
          "name": "song",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  111,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "song.songId",
                "account": "song"
              }
            ]
          }
        },
        {
          "name": "season",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  97,
                  115,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "song.seasonId",
                "account": "song"
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "mint",
          "relations": [
            "song"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "song"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "traderAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "trader"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "tokens",
          "type": "u64"
        },
        {
          "name": "minSol",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setPaused",
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
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
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "updateConfig",
      "discriminator": [
        29,
        158,
        252,
        191,
        10,
        83,
        219,
        99
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
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
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "configParams"
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "season",
      "discriminator": [
        76,
        67,
        93,
        156,
        180,
        157,
        248,
        47
      ]
    },
    {
      "name": "song",
      "discriminator": [
        144,
        84,
        211,
        50,
        100,
        5,
        81,
        24
      ]
    }
  ],
  "events": [
    {
      "name": "payoutApplied",
      "discriminator": [
        17,
        151,
        244,
        100,
        86,
        212,
        44,
        27
      ]
    },
    {
      "name": "seasonFinalized",
      "discriminator": [
        17,
        0,
        146,
        8,
        1,
        167,
        147,
        101
      ]
    },
    {
      "name": "songLaunched",
      "discriminator": [
        98,
        223,
        80,
        167,
        14,
        240,
        110,
        124
      ]
    },
    {
      "name": "songScored",
      "discriminator": [
        111,
        116,
        140,
        105,
        162,
        124,
        205,
        219
      ]
    },
    {
      "name": "traded",
      "discriminator": [
        225,
        202,
        73,
        175,
        147,
        43,
        160,
        150
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "overflow",
      "msg": "Math overflow"
    },
    {
      "code": 6001,
      "name": "insolvent",
      "msg": "Curve cannot pay this sell"
    },
    {
      "code": 6002,
      "name": "soldOut",
      "msg": "Curve is sold out"
    },
    {
      "code": 6003,
      "name": "zeroAmount",
      "msg": "Amount too small"
    },
    {
      "code": 6004,
      "name": "slippage",
      "msg": "Slippage limit exceeded"
    },
    {
      "code": 6005,
      "name": "paused",
      "msg": "Platform is paused"
    },
    {
      "code": 6006,
      "name": "seasonEnded",
      "msg": "Season has ended; trading resumes after settlement"
    },
    {
      "code": 6007,
      "name": "seasonNotEnded",
      "msg": "Season has not ended yet"
    },
    {
      "code": 6008,
      "name": "notTrading",
      "msg": "Song is not in the trading phase"
    },
    {
      "code": 6009,
      "name": "notScored",
      "msg": "Song has not been scored"
    },
    {
      "code": 6010,
      "name": "wrongSeason",
      "msg": "Song belongs to a different season"
    },
    {
      "code": 6011,
      "name": "seasonIncomplete",
      "msg": "Not every song in the season is scored"
    },
    {
      "code": 6012,
      "name": "alreadyFinalized",
      "msg": "Season is already finalized"
    },
    {
      "code": 6013,
      "name": "notFinalized",
      "msg": "Season is not finalized"
    },
    {
      "code": 6014,
      "name": "payoutsPending",
      "msg": "Previous season still has payouts to apply"
    },
    {
      "code": 6015,
      "name": "graceNotOver",
      "msg": "Only the oracle may score before the grace period ends"
    },
    {
      "code": 6016,
      "name": "badMetadata",
      "msg": "Name, symbol or URI too long or empty"
    },
    {
      "code": 6017,
      "name": "badConfig",
      "msg": "Config value out of bounds"
    },
    {
      "code": 6018,
      "name": "notPendingAdmin",
      "msg": "Signer is not the pending admin"
    },
    {
      "code": 6019,
      "name": "balanceMismatch",
      "msg": "Account balance does not cover its obligations"
    }
  ],
  "types": [
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "pendingAdmin",
            "type": "pubkey"
          },
          {
            "name": "oracle",
            "docs": [
              "Signs launches (verifies the song is real, sets its baseline) and season scores."
            ],
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "feeProtocolBps",
            "type": "u16"
          },
          {
            "name": "feeCreatorBps",
            "type": "u16"
          },
          {
            "name": "feePotBps",
            "type": "u16"
          },
          {
            "name": "stakeBps",
            "docs": [
              "Share of a song's curve SOL put at stake each season."
            ],
            "type": "u16"
          },
          {
            "name": "seasonSecs",
            "type": "i64"
          },
          {
            "name": "graceSecs",
            "docs": [
              "After a season ends, anyone may neutrally score songs the oracle skipped."
            ],
            "type": "i64"
          },
          {
            "name": "scoreSmoothing",
            "docs": [
              "Added to the baseline when scoring, so a 0 -> 50 listener song isn't infinite growth."
            ],
            "type": "u64"
          },
          {
            "name": "maxScore",
            "type": "u64"
          },
          {
            "name": "initialVirtualSol",
            "type": "u64"
          },
          {
            "name": "initialVirtualToken",
            "type": "u64"
          },
          {
            "name": "currentSeason",
            "type": "u32"
          },
          {
            "name": "unapplied",
            "docs": [
              "Songs of the last finalized season still waiting for apply_payout."
            ],
            "type": "u32"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "configParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oracle",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "feeProtocolBps",
            "type": "u16"
          },
          {
            "name": "feeCreatorBps",
            "type": "u16"
          },
          {
            "name": "feePotBps",
            "type": "u16"
          },
          {
            "name": "stakeBps",
            "type": "u16"
          },
          {
            "name": "seasonSecs",
            "type": "i64"
          },
          {
            "name": "graceSecs",
            "type": "i64"
          },
          {
            "name": "scoreSmoothing",
            "type": "u64"
          },
          {
            "name": "maxScore",
            "type": "u64"
          },
          {
            "name": "initialVirtualSol",
            "type": "u64"
          },
          {
            "name": "initialVirtualToken",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "launchArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "songId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "baseline",
            "type": "u64"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "symbol",
            "type": "string"
          },
          {
            "name": "uri",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "payoutApplied",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "song",
            "type": "pubkey"
          },
          {
            "name": "seasonId",
            "type": "u32"
          },
          {
            "name": "payout",
            "type": "u64"
          },
          {
            "name": "virtualSol",
            "type": "u64"
          },
          {
            "name": "realSol",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "phase",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "trading"
          },
          {
            "name": "scored"
          }
        ]
      }
    },
    {
      "name": "season",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u32"
          },
          {
            "name": "startTs",
            "type": "i64"
          },
          {
            "name": "endTs",
            "type": "i64"
          },
          {
            "name": "songCount",
            "type": "u32"
          },
          {
            "name": "scoredCount",
            "type": "u32"
          },
          {
            "name": "appliedCount",
            "type": "u32"
          },
          {
            "name": "pot",
            "docs": [
              "Lamports this account holds for the pot (fees, stakes, rollover), beyond rent."
            ],
            "type": "u64"
          },
          {
            "name": "staked",
            "docs": [
              "Sum of stakes taken this season (refunded if no song grew)."
            ],
            "type": "u64"
          },
          {
            "name": "payoutPot",
            "docs": [
              "Pot frozen at finalize, shared out by weight."
            ],
            "type": "u64"
          },
          {
            "name": "totalWeight",
            "type": "u128"
          },
          {
            "name": "finalized",
            "type": "bool"
          },
          {
            "name": "refund",
            "docs": [
              "No song grew: stakes go back, fees roll over."
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "seasonFinalized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seasonId",
            "type": "u32"
          },
          {
            "name": "payoutPot",
            "type": "u64"
          },
          {
            "name": "rollover",
            "type": "u64"
          },
          {
            "name": "totalWeight",
            "type": "u128"
          },
          {
            "name": "refund",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "song",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "songId",
            "docs": [
              "sha256 of the oracle's canonical song key (ISRC where known). One coin per song."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "seasonId",
            "type": "u32"
          },
          {
            "name": "phase",
            "type": {
              "defined": {
                "name": "phase"
              }
            }
          },
          {
            "name": "baseline",
            "docs": [
              "Traction index when this season started for the song."
            ],
            "type": "u64"
          },
          {
            "name": "virtualSol",
            "type": "u64"
          },
          {
            "name": "virtualToken",
            "type": "u64"
          },
          {
            "name": "realSol",
            "type": "u64"
          },
          {
            "name": "realToken",
            "type": "u64"
          },
          {
            "name": "initialVirtualToken",
            "type": "u64"
          },
          {
            "name": "creatorFees",
            "docs": [
              "Unclaimed creator fees, held in this account."
            ],
            "type": "u64"
          },
          {
            "name": "lastFinal",
            "type": "u64"
          },
          {
            "name": "lastScore",
            "type": "u64"
          },
          {
            "name": "lastStake",
            "type": "u64"
          },
          {
            "name": "lastWeight",
            "type": "u128"
          },
          {
            "name": "solSeconds",
            "docs": [
              "Integral of real_sol over time this season (lamport-seconds). Stakes and pot",
              "shares use the time-weighted average, so buying a known hit seconds before",
              "the season closes earns almost nothing."
            ],
            "type": "u128"
          },
          {
            "name": "accruedTs",
            "type": "i64"
          },
          {
            "name": "launchedTs",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "mintBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "songLaunched",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "song",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "songId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "seasonId",
            "type": "u32"
          },
          {
            "name": "baseline",
            "type": "u64"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "symbol",
            "type": "string"
          },
          {
            "name": "uri",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "songScored",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "song",
            "type": "pubkey"
          },
          {
            "name": "seasonId",
            "type": "u32"
          },
          {
            "name": "baseline",
            "type": "u64"
          },
          {
            "name": "finalTraction",
            "type": "u64"
          },
          {
            "name": "score",
            "type": "u64"
          },
          {
            "name": "stake",
            "type": "u64"
          },
          {
            "name": "snapshotHash",
            "docs": [
              "sha256 of the oracle's published raw snapshot (Last.fm / YouTube / Deezer)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "neutral",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "traded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "song",
            "type": "pubkey"
          },
          {
            "name": "trader",
            "type": "pubkey"
          },
          {
            "name": "isBuy",
            "type": "bool"
          },
          {
            "name": "sol",
            "type": "u64"
          },
          {
            "name": "tokens",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          },
          {
            "name": "virtualSol",
            "type": "u64"
          },
          {
            "name": "virtualToken",
            "type": "u64"
          },
          {
            "name": "realSol",
            "type": "u64"
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    }
  ]
};
