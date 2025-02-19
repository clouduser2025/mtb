import React, { useState, useEffect, useRef } from 'react';
import { Container, Button, Table, Form, Alert, Modal, Row, Col, Dropdown, ButtonGroup } from 'react-bootstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faUserCog, 
  faUserPlus, 
  faUsers, 
  faSignInAlt, 
  faShoppingCart, 
  faExchangeAlt,
  faUser,               
  faUserTie,
  faChartLine,
  faDollarSign,
  faChartBar,
  faHourglassHalf,
  faBullseye,
  faMapMarkerAlt
} from '@fortawesome/free-solid-svg-icons'; 
import './css/landing.css';

const Landing = () => {
  // ... (Keep all the existing state declarations and API functions unchanged)

  /********************************************************
   *                     RENDER (JSX)                     *
   ********************************************************/
  useEffect(() => {
    fetchUsers();
    fetchOpenPositions();
  }, []);

  return (
    <>
      <Container className="mt-4">
        {/* Move the message Alert to the top, below the navigation buttons */}
        {message.text && (
          <Alert 
            variant={message.type} 
            className="mt-3 mb-3" 
            style={{ position: "relative", top: "10%" }} // Adjust position to top 10% of viewport
          >
            {message.text}
          </Alert>
        )}

        <Row className="justify-content-end mb-3" style={{ position: "absolute", top: "9%", right: "10px", zIndex: "1000" }}>
          <Col xs="auto">
            <UserActionsDropdown setShowRegisterModal={setShowRegisterModal} setShowUsers={setShowUsers} showUsers={showUsers} />
          </Col>
        </Row>

        {showUsers && (
          <Container className="users-table-container mb-5">
            <h3 className="text-center mb-4 text-primary">
              <FontAwesomeIcon icon={faUsers} className="me-2" /> Registered Users
            </h3>
            <div className="table-responsive">
              <Table striped bordered hover className="users-table shadow-sm">
                <thead>
                  <tr>
                    <th className="table-header bg-primary text-white">#</th>
                    <th className="table-header bg-success text-white">Username</th>
                    <th className="table-header bg-info text-white">Role</th>
                    <th className="table-header bg-warning text-dark">Broker</th>
                    <th className="table-header bg-danger text-white">Default Quantity</th>
                    <th className="table-header bg-dark text-white">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length > 0 ? (
                    users.map((user, index) => (
                      <tr key={index}>
                        <td>{index + 1}</td>
                        <td>{user.username}</td>
                        <td>{user.role || "Trader"}</td>
                        <td>{user.broker}</td>
                        <td>{user.default_quantity}</td>
                        <td>
                          <Button variant="danger" size="sm" onClick={() => handleDeleteUser(user.username)}>
                            ❌ Delete
                          </Button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="6" className="text-muted text-center">No registered users found.</td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </div>
          </Container>
        )}

        {showTradesDashboard && (
          <>
            <Container className="mt-5 p-4 traders-table-container shadow-lg rounded bg-white">
              <h3 className="text-center mb-4 text-dark fw-bold">
                <FontAwesomeIcon icon={faExchangeAlt} className="me-2 text-primary" /> Active Trades
              </h3>
              <div className="table-responsive">
                <Table striped bordered hover className="traders-table shadow-sm">
                  <thead className="text-center">
                    <tr>
                      <th>#</th>
                      <th className="bg-primary text-white"><FontAwesomeIcon icon={faUser} /> Username</th>
                      <th className="bg-success text-white"><FontAwesomeIcon icon={faUserTie} /> Role</th>
                      <th className="bg-info text-white"><FontAwesomeIcon icon={faChartLine} /> Symbol</th>
                      <th className="bg-dark text-white"><FontAwesomeIcon icon={faDollarSign} /> Entry Price</th>
                      <th className="bg-danger text-white"><FontAwesomeIcon icon={faChartBar} /> Threshold</th>
                      <th className="bg-secondary text-white"><FontAwesomeIcon icon={faHourglassHalf} /> Exit Type</th>
                      <th className="bg-primary text-white"><FontAwesomeIcon icon={faBullseye} /> Exit Value</th>
                      <th className="bg-warning text-dark"><FontAwesomeIcon icon={faMapMarkerAlt} /> Position</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openTrades.length > 0 ? (
                      openTrades.map((trade, index) => (
                        <tr key={index} className="align-middle text-center">
                          <td><strong className="text-secondary">{index + 1}</strong></td>
                          <td className="fw-bold text-warning">{trade.username}</td>
                          <td><span className={`badge ${trade.user_role === "Admin" ? "bg-danger" : "bg-secondary"}`}>{trade.user_role}</span></td>
                          <td className="text-primary fw-bold">{trade.symbol}</td>
                          <td className="text-success fw-bold">₹{trade.entry_price}</td>
                          <td className="text-danger fw-bold">{trade.position_type === "LONG" ? trade.buy_threshold : trade.sell_threshold}</td>
                          <td className="text-warning">{trade.exit_condition_type}</td>
                          <td className="text-info">{trade.exit_condition_value}</td>
                          <td><span className={`badge ${trade.position_type === "LONG" ? "bg-success" : "bg-danger"}`}>{trade.position_type === "LONG" ? "Buy" : "Sell"}</span></td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="9" className="text-muted text-center">No active trades found.</td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </div>
            </Container>
            <Container className="mt-5 p-4 bg-light rounded shadow-lg">
              <h4 className="text-center mb-3 text-dark fw-bold">📊 Live Chart with Open Trades</h4>
              <AdvancedChart symbol={formData.tradingsymbol} openTrades={openTrades} />
            </Container>
          </>
        )}

        <Row className="justify-content-center mb-3">
          <Col xs="auto">
            <Button onClick={() => window.open('https://www.angelone.in/trade/markets/equity/overview', '_blank')} className="gradient-button btn-market">
              Market Overview
            </Button>
          </Col>
          <Col xs="auto">
            <Button onClick={() => window.open('https://www.angelone.in/trade/indices/indian', '_blank')} className="gradient-button btn-indices">
              Indices
            </Button>
          </Col>
          <Col xs="auto">
            <Button onClick={() => window.open('https://www.angelone.in/trade/watchlist/chart', '_blank')} className="gradient-button btn-chart">
              Chart
            </Button>
          </Col>
          <Col xs="auto">
            <Button onClick={() => window.open('https://www.angelone.in/trade/watchlist/option-chain', '_blank')} className="gradient-button btn-option">
              Option Chain
            </Button>
          </Col>
          <Col xs="auto">
            <Button onClick={fetchLtp} className="gradient-button btn-ltp" disabled={loadingLtp}>
              {loadingLtp ? "Fetching..." : "Fetch LTP"}
            </Button>
          </Col>
          <Col xs="auto">
            <Button onClick={() => { setShowTradesDashboard(!showTradesDashboard); fetchOpenPositions(); }} className="gradient-button btn-trades">
              Trades Dashboard
            </Button>
          </Col>
        </Row>

        <Container className="ltp-container">
          <h4 className="text-primary">🔍 Live Fetch LTP</h4>
          <Form onSubmit={(e) => { e.preventDefault(); fetchLtp(); }}>
            <Row className="mb-3">
              <Col md={3}>
                <Form.Group controlId="exchange">
                  <Form.Label>Select Exchange</Form.Label>
                  <Form.Select value={formData.exchange} onChange={(e) => setFormData({ ...formData, exchange: e.target.value })}>
                    <option value="NSE">NSE</option>
                    <option value="BSE">BSE</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group controlId="tradingsymbol">
                  <Form.Label>Enter Trading Symbol</Form.Label>
                  <Form.Control type="text" placeholder="e.g., SBIN-EQ" value={formData.tradingsymbol} onChange={(e) => setFormData({ ...formData, tradingsymbol: e.target.value })} required />
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group controlId="symboltoken">
                  <Form.Label>Enter Symbol Token</Form.Label>
                  <Form.Control type="text" placeholder="e.g., 3045" value={formData.symboltoken} onChange={(e) => setFormData({ ...formData, symboltoken: e.target.value })} required />
                </Form.Group>
              </Col>
              <Col md={2}>
                <Button type="submit" variant="primary" className="mt-4">Fetch LTP</Button>
              </Col>
            </Row>
          </Form>
          {loadingLtp && <p>Loading...</p>}
          {ltpPrice !== null && (
            <Alert variant="success">📈 Latest Price of <strong>{formData.tradingsymbol}</strong>: ₹{ltpPrice}</Alert>
          )}
        </Container>

        {/* Multi-Step Trade Form */}
        <Container className="mt-4 p-3 border rounded shadow-sm">
          {formStep === 1 && (
            <>
              <h4 className="text-primary">
                <FontAwesomeIcon icon={faUsers} /> Select Users (1 to 3)
              </h4>
              <Form>
                <Row className="mb-3">
                  <Col>
                    {users.map((user, index) => (
                      <Form.Check
                        key={index}
                        type="checkbox"
                        label={user.username}
                        checked={selectedUsers.includes(user.username)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            if (selectedUsers.length < 3) {
                              setSelectedUsers([...selectedUsers, user.username]);
                            } else {
                              alert("⚠ You can only select up to 3 users.");
                            }
                          } else {
                            setSelectedUsers(selectedUsers.filter(u => u !== user.username));
                          }
                        }}
                      />
                    ))}
                  </Col>
                </Row>
                <Button 
                  variant="primary" 
                  onClick={() => {
                    if (selectedUsers.length === 0) {
                      alert("Please select at least 1 user.");
                    } else {
                      setFormStep(2);
                    }
                  }}
                  className="mt-3"
                >
                  Next
                </Button>
              </Form>
            </>
          )}

          {formStep === 2 && (
            <>
              <h4 className="text-primary">
                <FontAwesomeIcon icon={faBullseye} /> Set Trade Conditions
              </h4>
              <Form>
                <Row className="mb-3">
                  <Col md={4}>
                    <Form.Group controlId="tradingsymbol">
                      <Form.Label>Trading Symbol</Form.Label>
                      <Form.Control 
                        type="text" 
                        placeholder="e.g., SBIN-EQ" 
                        value={formData.tradingsymbol} 
                        onChange={(e) => setFormData({ ...formData, tradingsymbol: e.target.value })}
                        required 
                      />
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group controlId="symboltoken">
                      <Form.Label>Symbol Token</Form.Label>
                      <Form.Control 
                        type="text" 
                        placeholder="e.g., 3045" 
                        value={formData.symboltoken} 
                        onChange={(e) => setFormData({ ...formData, symboltoken: e.target.value })}
                        required 
                      />
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group controlId="strike_price">
                      <Form.Label>Strike Price</Form.Label>
                      <Form.Control 
                        type="number" 
                        placeholder="e.g., 100" 
                        value={formData.strike_price} 
                        onChange={(e) => setFormData({ ...formData, strike_price: parseFloat(e.target.value) || 0 })}
                        required 
                      />
                    </Form.Group>
                  </Col>
                </Row>
                <Row className="mb-3">
                  {actionType === 'buy' && (
                    <>
                      <Col md={4}>
                        <Form.Group controlId="buy_threshold_offset">
                          <Form.Label>Buy Threshold Offset</Form.Label>
                          <Form.Control 
                            type="number" 
                            placeholder="e.g., 10 for +10" 
                            value={formData.buy_threshold_offset} 
                            onChange={(e) => setFormData({ ...formData, buy_threshold_offset: parseFloat(e.target.value) || 0 })}
                          />
                        </Form.Group>
                      </Col>
                      <Col md={4}>
                        <Form.Group controlId="buy_percentage">
                          <Form.Label>Buy Percentage Increase (%)</Form.Label>
                          <Form.Control 
                            type="number" 
                            placeholder="e.g., 5 for 5%" 
                            value={formData.buy_percentage} 
                            onChange={(e) => setFormData({ ...formData, buy_percentage: parseFloat(e.target.value) || 0 })}
                          />
                        </Form.Group>
                      </Col>
                    </>
                  )}
                  {actionType === 'sell' && (
                    <>
                      <Col md={4}>
                        <Form.Group controlId="sell_threshold_offset">
                          <Form.Label>Sell Threshold Offset</Form.Label>
                          <Form.Control 
                            type="number" 
                            placeholder="e.g., -10 for -10" 
                            value={formData.sell_threshold_offset} 
                            onChange={(e) => setFormData({ ...formData, sell_threshold_offset: parseFloat(e.target.value) || 0 })}
                          />
                        </Form.Group>
                      </Col>
                      <Col md={4}>
                        <Form.Group controlId="sell_percentage">
                          <Form.Label>Sell Percentage Decrease (%)</Form.Label>
                          <Form.Control 
                            type="number" 
                            placeholder="e.g., 5 for 5%" 
                            value={formData.sell_percentage} 
                            onChange={(e) => setFormData({ ...formData, sell_percentage: parseFloat(e.target.value) || 0 })}
                          />
                        </Form.Group>
                      </Col>
                    </>
                  )}
                  <Col md={4}>
                    <Form.Group controlId="stop_loss_type">
                      <Form.Label>Exit Condition Type</Form.Label>
                      <Form.Select 
                        value={formData.stop_loss_type} 
                        onChange={(e) => setFormData({ ...formData, stop_loss_type: e.target.value })}
                      >
                        <option value="Fixed">Fixed</option>
                        <option value="Percentage">Percentage</option>
                        <option value="Points">Points</option>
                      </Form.Select>
                    </Form.Group>
                  </Col>
                </Row>
                <Row className="mb-3">
                  <Col md={4}>
                    <Form.Group controlId="stop_loss_value">
                      <Form.Label>Exit Condition Value</Form.Label>
                      <Form.Control 
                        type="number" 
                        placeholder="e.g., 5 or 50%" 
                        value={formData.stop_loss_value} 
                        onChange={(e) => setFormData({ ...formData, stop_loss_value: parseFloat(e.target.value) || 0 })}
                        required 
                      />
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group controlId="points_condition">
                      <Form.Label>Points Condition</Form.Label>
                      <Form.Control 
                        type="number" 
                        placeholder="e.g., 0 or -0.2" 
                        value={formData.points_condition} 
                        onChange={(e) => setFormData({ ...formData, points_condition: parseFloat(e.target.value) || 0 })}
                      />
                    </Form.Group>
                  </Col>
                </Row>
                <Button 
                  variant="primary" 
                  onClick={() => setFormStep(3)}
                  className="mt-3"
                >
                  Next
                </Button>
                <Button 
                  variant="secondary" 
                  onClick={() => { setFormStep(1); setSelectedUsers([]); }}
                  className="mt-3 ms-2"
                >
                  Back
                </Button>
              </Form>
            </>
          )}

          {formStep === 3 && (
            <>
              <h4 className={actionType === 'buy' ? "text-success" : "text-danger"}>
                <FontAwesomeIcon icon={actionType === 'buy' ? faShoppingCart : faExchangeAlt} /> Confirm {actionType === 'buy' ? 'Buy' : 'Sell'}
              </h4>
              <Form>
                <Row className="mb-3">
                  <Col>
                    <p><strong>Selected Users:</strong> {selectedUsers.join(", ") || "None"}</p>
                    <p><strong>Symbol:</strong> {formData.tradingsymbol}</p>
                    <p><strong>Strike Price:</strong> ₹{formData.strike_price}</p>
                    <p><strong>{actionType === 'buy' ? 'Buy' : 'Sell'} Threshold:</strong> {actionType === 'buy' ? 
                      (formData.buy_threshold_offset ? `≥ ${formData.strike_price + formData.buy_threshold_offset}` : 
                       formData.buy_percentage ? `≥ ${formData.strike_price * (1 + formData.buy_percentage/100)}` : "None") : 
                      (formData.sell_threshold_offset ? `≤ ${formData.strike_price + formData.sell_threshold_offset}` : 
                       formData.sell_percentage ? `≤ ${formData.strike_price * (1 - formData.sell_percentage/100)}` : "None")}</p>
                    <p><strong>Exit Condition:</strong> {formData.stop_loss_type} at {formData.stop_loss_value} {formData.stop_loss_type === "Percentage" ? "%" : ""} (Points: {formData.points_condition})</p>
                    {ltpPrice && <p><strong>Current LTP:</strong> ₹{ltpPrice}</p>}
                  </Col>
                </Row>
                <Button 
                  variant={actionType === 'buy' ? "success" : "danger"} 
                  onClick={handleInitiateTrade}
                  className="mt-3"
                  disabled={loadingLtp || !ltpPrice}
                >
                  Confirm {actionType === 'buy' ? 'Buy' : 'Sell'}
                </Button>
                <Button 
                  variant="secondary" 
                  onClick={() => setFormStep(2)}
                  className="mt-3 ms-2"
                >
                  Back
                </Button>
              </Form>
            </>
          )}
        </Container>

        <Row className="justify-content-center mb-3">
          <Col xs="auto">
            <Button onClick={() => { setActionType('buy'); setFormStep(1); }} className="gradient-button btn-buy">
              <FontAwesomeIcon icon={faShoppingCart} /> Buy
            </Button>
          </Col>
          <Col xs="auto">
            <Button onClick={() => { setActionType('sell'); setFormStep(1); }} className="gradient-button btn-sell">
              <FontAwesomeIcon icon={faExchangeAlt} /> Sell
            </Button>
          </Col>
        </Row>
      </Container>

      <Modal show={showRegisterModal} onHide={() => setShowRegisterModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Register User</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {message.text && <Alert variant={message.type}>{message.text}</Alert>}
          <Form onSubmit={handleRegisterSubmit}>
            <Form.Group controlId="username">
              <Form.Label>Username</Form.Label>
              <Form.Control type="text" placeholder="Enter username" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} required />
            </Form.Group>
            <Form.Group controlId="password">
              <Form.Label>Password</Form.Label>
              <Form.Control type="password" placeholder="Enter password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} required />
            </Form.Group>
            <Form.Group controlId="broker">
              <Form.Label>Broker</Form.Label>
              <Form.Select value={formData.broker} onChange={(e) => setFormData({ ...formData, broker: e.target.value })}>
                <option value="Angel">Angel</option>
                <option value="Zerodha">Zerodha</option>
              </Form.Select>
            </Form.Group>
            <Form.Group controlId="api_key">
              <Form.Label>API Key</Form.Label>
              <Form.Control type="text" placeholder="Enter API Key" value={formData.api_key} onChange={(e) => setFormData({ ...formData, api_key: e.target.value })} required />
            </Form.Group>
            <Form.Group controlId="totp_token">
              <Form.Label>TOTP Token</Form.Label>
              <Form.Control type="text" placeholder="Enter TOTP Token" value={formData.totp_token} onChange={(e) => setFormData({ ...formData, totp_token: e.target.value })} required />
            </Form.Group>
            <Form.Group controlId="default_quantity">
              <Form.Label>Default Quantity</Form.Label>
              <Form.Control type="number" placeholder="Enter Quantity" value={formData.default_quantity} onChange={(e) => setFormData({ ...formData, default_quantity: e.target.value })} required />
            </Form.Group>
            <Button variant="primary" type="submit" className="mt-3">Register</Button>
          </Form>
        </Modal.Body>
      </Modal>

      {/* Remove the message Alert from here since it's now at the top */}
    </>
  );
};

export default Landing;